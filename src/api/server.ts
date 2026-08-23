/**
 * Die Hono-App: Middleware-Kette, Fehlerübersetzung, Routen.
 *
 * Der wichtigste Gedanke steckt in der Reihenfolge: `anmeldungPruefen` läuft
 * VOR allen Routen. Was ohne Anmeldung erreichbar sein soll, steht in einer
 * kurzen, ausdrücklichen Liste (OFFEN). Ein neu hinzugefügter Endpunkt ist
 * dadurch automatisch geschützt — Vergessen führt zur Sperre, nicht zum Leck.
 *
 * Exportiert wird `app` für Tests: die laufen über `app.request()` gegen
 * genau diese Kette, ohne dass ein Server gestartet werden muss.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { serveStatic } from "@hono/node-server/serve-static";
import { ZodError } from "zod";
import { PRODUKTION } from "../config.js";
import type postgres from "postgres";
import { db } from "../db/client.js";
import { logError } from "../logger.js";
import { anmeldungPruefen, type AppEnv } from "./auth.js";
import {
  EingabeFehler,
  KeinRecht,
  KonfliktFehler,
  NichtAngemeldet,
  NichtGefunden,
  RegelFehler,
} from "./fehler.js";
import { austauschRouten } from "./routes/austausch.js";
import { authRouten } from "./routes/auth.js";
import { benutzerRouten } from "./routes/benutzer.js";
import { buchungsRouten } from "./routes/buchungen.js";
import { dateiRouten } from "./routes/dateien.js";
import { etikettenRouten } from "./routes/etiketten.js";
import { geraeteRouten } from "./routes/geraete.js";
import { pflegeRouten } from "./routes/pflege.js";
import { scanRouten } from "./routes/scan.js";
import { stammdatenRouten } from "./routes/stammdaten.js";

export const app = new Hono<AppEnv>();

/**
 * Die einzigen Pfade unter /api, die ohne Anmeldung antworten.
 *
 * Wer hier etwas einträgt, öffnet es dem gesamten Internet. Der Test
 * `tests/api-auth-abdeckung.test.ts` prüft jede registrierte Route gegen
 * diese Liste und schlägt fehl, sobald etwas anderes ohne Cookie antwortet.
 */
export const OFFEN: ReadonlySet<string> = new Set([
  "/api/health", // Container-Healthcheck
  "/api/auth/login", // sonst käme niemand herein
]);

// ── Zentrale Fehlerübersetzung ──────────────────────────────────────────────
// Ohne sie beantwortet Hono jeden Wurf mit einem nackten "Internal Server
// Error" als reinem Text — das Frontend erwartet überall JSON und zeigte dem
// Benutzer dann einen Parse-Fehler statt einer Meldung.
//
// Nach außen geht NIE ein Stacktrace, ein SQL-Text oder ein Pfad. Details
// stehen im Protokoll.
app.onError((fehler, c) => {
  if (fehler instanceof HTTPException) return fehler.getResponse();

  if (fehler instanceof NichtAngemeldet) return c.json({ error: fehler.message }, 401);
  if (fehler instanceof KeinRecht) return c.json({ error: fehler.message }, 403);
  if (fehler instanceof NichtGefunden) return c.json({ error: fehler.message }, 404);
  if (fehler instanceof EingabeFehler) {
    return c.json({ error: fehler.message, felder: fehler.felder }, 400);
  }
  if (fehler instanceof RegelFehler) {
    return c.json({ error: fehler.message, grund: fehler.grund }, 409);
  }
  if (fehler instanceof KonfliktFehler) {
    return c.json(
      {
        error: fehler.message,
        konflikt: true,
        erwarteteRev: fehler.erwartet,
        aktuelleRev: fehler.tatsaechlich,
        aktuell: fehler.aktuell,
      },
      409,
    );
  }

  // Zod meldet ungültige Eingaben. 400, kein Serverfehler.
  if (fehler instanceof ZodError) {
    return c.json({ error: "Die Eingabe ist unvollständig oder fehlerhaft." }, 400);
  }

  // Kaputter JSON-Rumpf: Client-Fehler, nicht unserer.
  if (fehler instanceof SyntaxError) {
    return c.json({ error: "Der gesendete Inhalt ist kein gültiges JSON." }, 400);
  }

  const code = (fehler as NodeJS.ErrnoException).code ?? "";
  // 22P02 = keine gültige UUID im Pfad. Ohne diesen Zweig käme ein 500,
  // was in jeder Überwachung wie ein Ausfall aussieht.
  if (code === "22P02") return c.json({ error: "Ungültige ID im Pfad." }, 400);

  // 23505 = Verstoß gegen eine Eindeutigkeitsregel. Das ist keine Störung,
  // sondern eine Kollision: zwei Leute vergeben zur selben Sekunde dieselbe
  // Nummer, oder jemand trägt eine bereits vorhandene von Hand ein.
  //
  // Der eigentliche Schutz sitzt in der Nummernvergabe (siehe
  // naechsteFreieNummerInTx in src/data/geraete.ts). Dieser Zweig ist die
  // zweite Sicherung — und sorgt dafür, dass der Benutzer eine Erklärung
  // bekommt statt eines Serverfehlers.
  if (code === "23505") {
    const feld = (fehler as { constraint_name?: string }).constraint_name ?? "";
    const meldung = feld.includes("inventarnummer")
      ? "Diese Inventarnummer ist bereits vergeben."
      : feld.includes("barcode")
        ? "Dieses Etikett gehört bereits zu einem Gerät."
        : feld.includes("benutzername") || feld.includes("email")
          ? "Dieser Benutzername oder diese E-Mail-Adresse ist bereits vergeben."
          : "Dieser Eintrag gibt es bereits.";
    return c.json({ error: meldung }, 409);
  }
  if (code === "53300" || code === "ECONNREFUSED") {
    logError("Datenbank nicht erreichbar", { pfad: c.req.path, fehler });
    return c.json({ error: "Datenbank derzeit nicht erreichbar. Bitte kurz warten." }, 503);
  }
  if (code === "57014") {
    logError("Abfrage abgebrochen (Zeitüberschreitung)", { pfad: c.req.path });
    return c.json({ error: "Die Anfrage hat zu lange gedauert." }, 503);
  }
  if (code === "EACCES" || code === "EPERM") {
    logError("Kein Dateizugriff", { pfad: c.req.path, fehler });
    return c.json({ error: "Kein Zugriff auf die Datei." }, 403);
  }
  if (code === "ENOSPC") {
    logError("Kein Speicherplatz", { pfad: c.req.path });
    return c.json({ error: "Kein Speicherplatz mehr auf dem Server." }, 507);
  }

  logError("Unbehandelter Fehler", { pfad: c.req.path, methode: c.req.method, fehler });
  return c.json({ error: "Ein Fehler ist aufgetreten. Details stehen im Protokoll." }, 500);
});

// ── Sicherheits-Kopfzeilen ──────────────────────────────────────────────────
// Die Richtlinie ist ERZWINGEND, nicht nur berichtend. PATIO fährt sie im
// Report-Only-Modus mit dem Vorsatz, später zu verschärfen — das passiert
// erfahrungsgemäß nie. Hier von Anfang an scharf; wenn etwas bricht, fällt
// es sofort auf und nicht erst im Betrieb.
//
// 'wasm-unsafe-eval' ist nötig, weil der Barcode-Leser (zxing) WebAssembly
// ausführt. 'unsafe-inline' bei den Stilen kommt von Vue-Scoped-Styles.
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: PRODUKTION ? "max-age=63072000; includeSubDomains" : false,
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    referrerPolicy: "same-origin",
    permissionsPolicy: { camera: ["self"], geolocation: [], microphone: [] },
  }),
);

// ── Gesundheitsprüfung ──────────────────────────────────────────────────────
// Steht NACH den Kopfzeilen-Middleware, sonst bekäme dieser Endpunkt keine
// Sicherheits-Kopfzeilen — Hono wertet in Registrierungsreihenfolge aus.
// (Beim ersten Testlauf genau so aufgefallen.)
//
// Bewusst ohne Angaben zu Version, Datenbank oder Laufzeit: Der Endpunkt ist
// anonym erreichbar, je weniger er über das Innenleben verrät, desto besser.
// Er sagt nur, OB die Anwendung arbeiten kann — nicht warum nicht.
//
// Dass er dafür die Datenbank anfassen muss, hat dieser Betrieb gelehrt:
// Vorher antwortete er immer `{ok:true}`, und Docker meldete `healthy`,
// während jede Anmeldung an einer weggebrochenen Datenbankverbindung
// scheiterte. Ein Gesundheitsbericht, der nur die eigene Existenz bestätigt,
// ist keiner.

/**
 * Zwischenspeicher für den Zustand.
 *
 * Der Endpunkt ist anonym erreichbar — ohne ihn könnte eine Anfrageflut
 * Datenbanklast erzeugen. Der Docker-Healthcheck fragt alle 30 Sekunden;
 * fünf Sekunden Gedächtnis merkt er nicht, ein Angreifer schon.
 */
const HEALTH_GEDAECHTNIS_MS = 5_000;
let healthStand: { zeit: number; gesund: boolean } | null = null;

/**
 * Antwortet die Datenbank?
 *
 * `sql` ist nur für die Prüfung da: Wer einen Client ausdrücklich übergibt,
 * bekommt das Ergebnis für GENAU diesen — ohne Gedächtnis. Sonst könnte ein
 * Test mit einem absichtlich toten Client den Zustand des laufenden Betriebs
 * überschreiben, und der Container ginge fälschlich auf `unhealthy`.
 */
export async function datenbankErreichbar(sql?: postgres.Sql): Promise<boolean> {
  const eigener = sql !== undefined;
  const jetzt = Date.now();

  if (!eigener && healthStand && jetzt - healthStand.zeit < HEALTH_GEDAECHTNIS_MS) {
    return healthStand.gesund;
  }

  let gesund = true;
  try {
    await (sql ?? db())`SELECT 1`;
  } catch {
    gesund = false;
  }

  if (!eigener) healthStand = { zeit: jetzt, gesund };
  return gesund;
}

app.get("/api/health", async (c) => {
  const gesund = await datenbankErreichbar();
  return c.json({ ok: gesund }, gesund ? 200 : 503);
});

// ── Standard: gesperrt ──────────────────────────────────────────────────────
// Läuft vor allen Routen. Alles unter /api ist geschützt, außer es steht in
// OFFEN. Diese Reihenfolge ist der eigentliche Schutz — eine Liste dessen,
// was geschützt sein SOLL, würde man früher oder später unvollständig lassen.
app.use("/api/*", async (c, next) => {
  if (OFFEN.has(c.req.path)) return next();
  return anmeldungPruefen(c, next);
});

// ── Routen ──────────────────────────────────────────────────────────────────
app.route("/api", authRouten);
app.route("/api", stammdatenRouten);
app.route("/api", geraeteRouten);
app.route("/api", buchungsRouten);
app.route("/api", scanRouten);
app.route("/api", dateiRouten);
app.route("/api", pflegeRouten);
app.route("/api", austauschRouten);
app.route("/api", etikettenRouten);
app.route("/api", benutzerRouten);

// Alles unter /api, was keine Route trifft, bekommt JSON statt der
// HTML-Auslieferung weiter unten — sonst versucht das Frontend, eine
// Fehlerseite als JSON zu lesen.
app.all("/api/*", (c) => c.json({ error: "Diesen Endpunkt gibt es nicht." }, 404));

// ── Oberfläche ──────────────────────────────────────────────────────────────
// Die gebaute Vue-Anwendung liegt in dist/web und wird vom selben Prozess
// ausgeliefert: eine Anwendung, ein Port, ein Container. Kein zweiter
// Webserver, der mitgepflegt und mitabgesichert werden müsste.
//
// Die Dateien enthalten KEINE Daten — ohne gültiges Cookie zeigt die
// Anwendung sofort die Anmeldung, und jede Datenroute antwortet mit 401.
app.use(
  "/*",
  serveStatic({
    root: "./dist/web",
    // Alles mit Prüfsumme im Namen darf der Browser lange behalten;
    // index.html niemals, sonst sieht man nach einem Update den alten Stand.
    onFound: (pfad, c) => {
      if (pfad.includes("/assets/")) {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      } else {
        c.header("Cache-Control", "no-cache");
      }
    },
  }),
);

// Rückfall für die Adressen der Einzelseiten-Anwendung: Wer /geraete/123
// direkt aufruft oder die Seite dort neu lädt, bekommt die index.html —
// den Weg findet danach der Router im Browser.
app.get("/*", serveStatic({ path: "./dist/web/index.html" }));
