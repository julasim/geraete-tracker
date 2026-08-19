/**
 * Anmelden, abmelden, Passwort ändern.
 *
 * Der wichtigste Grundsatz hier: Ein Fehlschlag verrät nie, WARUM er
 * fehlgeschlagen ist. Ob das Konto gar nicht existiert oder nur das Passwort
 * falsch war, macht weder im Text noch in der Antwortzeit einen Unterschied —
 * sonst könnte jemand in Ruhe gültige Benutzernamen sammeln, bevor er
 * überhaupt anfängt, Passwörter zu raten.
 */

import { Hono } from "hono";
import { z } from "zod";
import { SPERRE_MINUTEN, SPERRE_NACH_VERSUCHEN } from "../../config.js";
import {
  findeFuerAnmeldung,
  protokolliereAnmeldung,
  setzePasswort,
  vermerkeAnmeldung,
  vermerkeFehlversuch,
  beendeAlleSitzungen,
} from "../../data/benutzer.js";
import {
  blindPruefung,
  hashePasswort,
  istGeleakt,
  pruefePasswort,
  pruefeRegeln,
} from "../../domain/passwort.js";
import { rechteVonRolle } from "../../data/rollen.js";
import { logInfo, logWarn } from "../../logger.js";
import {
  angemeldet,
  anmeldungPruefen,
  rechteVon,
  loescheSitzungsCookie,
  setzeSitzungsCookie,
  stelleTokenAus,
  type AppEnv,
} from "../auth.js";
import { ipUeberlastet, klientIp, pruefeSperre, warte, warteZeitMs } from "../bremse.js";
import { EingabeFehler } from "../fehler.js";

export const authRouten = new Hono<AppEnv>();

/** Immer dieselbe Meldung, egal woran es lag. */
const ABWEISUNG = "Benutzername oder Passwort ist falsch.";

/**
 * Wartezeit für einen Versuch auf ein Konto, das es nicht gibt. Fest, weil
 * es keinen Zähler gibt, an dem sie wachsen könnte — aber nicht null, damit
 * unbekannte Konten sich nicht durch schnellere Antworten verraten.
 */
const AB_UNBEKANNT = 4;

const anmeldeSchema = z.object({
  kennung: z.string().min(1).max(200),
  passwort: z.string().min(1).max(200),
});

authRouten.post("/auth/login", async (c) => {
  const ip = klientIp(c);
  const userAgent = c.req.header("user-agent");

  const roh = await c.req.json().catch(() => null);
  const gelesen = anmeldeSchema.safeParse(roh);
  if (!gelesen.success) {
    throw new EingabeFehler("Benutzername und Passwort werden benötigt.");
  }
  const { kennung, passwort } = gelesen.data;

  // Stufe 3: kommt von dieser Adresse ohnehin schon zu viel?
  if (await ipUeberlastet(ip)) {
    logWarn("Anmeldung wegen zu vieler Versuche von dieser Adresse abgewiesen", { ip });
    return c.json(
      { error: `Zu viele Fehlversuche. Bitte ${SPERRE_MINUTEN} Minuten warten.` },
      429,
    );
  }

  const konto = await findeFuerAnmeldung(kennung);

  // Konto unbekannt: trotzdem rechnen, damit die Antwortzeit nichts verrät.
  if (!konto) {
    await blindPruefung(passwort);
    await warte(warteZeitMs(AB_UNBEKANNT));
    await protokolliereAnmeldung({ kennung, ip, erfolg: false, grund: "unbekannt", userAgent });
    return c.json({ error: ABWEISUNG }, 401);
  }

  // Stufe 2: Konto gesperrt?
  const sperre = pruefeSperre(konto.gesperrt_bis);
  if (sperre.gesperrt) {
    await protokolliereAnmeldung({ kennung, ip, erfolg: false, grund: "gesperrt", userAgent });
    return c.json(
      {
        error: `Das Konto ist wegen zu vieler Fehlversuche vorübergehend gesperrt. ` +
          `Bitte ${Math.ceil(sperre.bisSekunden / 60)} Minuten warten.`,
        gesperrtSekunden: sperre.bisSekunden,
      },
      429,
    );
  }

  const stimmt = await pruefePasswort(passwort, konto.passwort_hash);

  if (!stimmt) {
    // Stufe 1: Verzögerung, die mit jedem Fehlversuch wächst.
    const stand = await vermerkeFehlversuch(konto.id, SPERRE_NACH_VERSUCHEN, SPERRE_MINUTEN);
    await warte(warteZeitMs(stand.fehlversuche));
    await protokolliereAnmeldung({
      kennung,
      ip,
      erfolg: false,
      grund: "passwort_falsch",
      userAgent,
    });

    const jetztGesperrt = pruefeSperre(stand.gesperrt_bis);
    if (jetztGesperrt.gesperrt) {
      logWarn("Konto nach zu vielen Fehlversuchen gesperrt", {
        benutzer: konto.benutzername,
        ip,
        fehlversuche: stand.fehlversuche,
      });
      return c.json(
        {
          error:
            `Das Konto ist wegen zu vieler Fehlversuche für ` +
            `${SPERRE_MINUTEN} Minuten gesperrt.`,
          gesperrtSekunden: jetztGesperrt.bisSekunden,
        },
        429,
      );
    }
    return c.json({ error: ABWEISUNG }, 401);
  }

  // Deaktivierte Konten scheitern erst HIER, nicht früher — sonst ließe sich
  // an der Antwort ablesen, dass es das Konto gibt.
  if (!konto.aktiv) {
    await protokolliereAnmeldung({ kennung, ip, erfolg: false, grund: "inaktiv", userAgent });
    return c.json({ error: ABWEISUNG }, 401);
  }

  await vermerkeAnmeldung(konto.id);
  await protokolliereAnmeldung({ kennung, ip, erfolg: true, grund: "ok", userAgent });
  setzeSitzungsCookie(c, stelleTokenAus(konto));
  logInfo("Anmeldung erfolgreich", { benutzer: konto.benutzername, ip });

  return c.json({
    benutzer: oeffentlich(konto),
    rechte: await rechteVonRolle(konto.rolle),
    passwortWechselNoetig: konto.passwort_wechsel_noetig,
  });
});

authRouten.post("/auth/logout", anmeldungPruefen, (c) => {
  loescheSitzungsCookie(c);
  return c.json({ ok: true });
});

/** Meldet ALLE Geräte ab — für den Fall "Handy verloren". */
authRouten.post("/auth/logout-alle", anmeldungPruefen, async (c) => {
  const benutzer = angemeldet(c);
  await beendeAlleSitzungen(benutzer.id);
  loescheSitzungsCookie(c);
  logInfo("Alle Sitzungen beendet", { benutzer: benutzer.benutzername });
  return c.json({ ok: true });
});

authRouten.get("/auth/me", anmeldungPruefen, (c) => {
  const benutzer = angemeldet(c);
  return c.json({
    benutzer: oeffentlich(benutzer),
    // Die Rechte gehen an die Oberfläche, damit sie Knöpfe ausblenden kann.
    // Das ist Bequemlichkeit, kein Schutz — der sitzt im Server, und wer
    // hier etwas manipuliert, bekommt beim Drücken trotzdem einen 403.
    rechte: rechteVon(c),
    passwortWechselNoetig: benutzer.passwort_wechsel_noetig,
  });
});

const passwortSchema = z.object({
  altesPasswort: z.string().min(1).max(200),
  neuesPasswort: z.string().min(1).max(200),
});

authRouten.post("/auth/passwort", anmeldungPruefen, async (c) => {
  const benutzer = angemeldet(c);

  const gelesen = passwortSchema.safeParse(await c.req.json().catch(() => null));
  if (!gelesen.success) throw new EingabeFehler("Altes und neues Passwort werden benötigt.");
  const { altesPasswort, neuesPasswort } = gelesen.data;

  // Das alte Passwort ist Pflicht: Wer ein unbeaufsichtigtes, angemeldetes
  // Gerät findet, soll das Konto nicht übernehmen können.
  const konto = await findeFuerAnmeldung(benutzer.benutzername);
  if (!konto || !(await pruefePasswort(altesPasswort, konto.passwort_hash))) {
    await warte(1000);
    return c.json({ error: "Das bisherige Passwort ist falsch." }, 401);
  }

  const regeln = pruefeRegeln(neuesPasswort, benutzer.benutzername);
  if (!regeln.ok) return c.json({ error: regeln.fehler.join(" "), felder: regeln.fehler }, 400);

  const leak = await istGeleakt(neuesPasswort);
  if (leak.geleakt) {
    return c.json(
      {
        error:
          `Dieses Passwort taucht in bekannten Datenlecks auf ` +
          `(${leak.treffer.toLocaleString("de-AT")} mal). Bitte ein anderes wählen.`,
      },
      400,
    );
  }

  await setzePasswort(benutzer.id, await hashePasswort(neuesPasswort), false);

  // setzePasswort erhöht token_version — die eigene Sitzung wäre damit auch
  // ungültig. Deshalb sofort ein frisches Cookie: wer sein Passwort ändert,
  // bleibt angemeldet, alle anderen Geräte fliegen raus.
  setzeSitzungsCookie(c, stelleTokenAus({ ...benutzer, token_version: benutzer.token_version + 1 }));
  logInfo("Passwort geändert", { benutzer: benutzer.benutzername });

  return c.json({ ok: true, hinweis: "Andere Geräte wurden abgemeldet." });
});

function oeffentlich(b: {
  id: string;
  benutzername: string;
  anzeigename: string;
  email: string | null;
  rolle: string;
}) {
  return {
    id: b.id,
    benutzername: b.benutzername,
    anzeigename: b.anzeigename,
    email: b.email,
    rolle: b.rolle,
  };
}
