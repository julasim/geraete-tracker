/**
 * Rauchtest gegen die WIRKLICH laufende Anwendung.
 *
 * Die Testsuite läuft über app.request() gegen die Hono-Kette im selben
 * Prozess. Das ist schnell, prüft aber nicht, ob der gebaute Server
 * tatsächlich startet, lauscht und antwortet.
 *
 * node:http statt fetch(): fetch ist in dieser Umgebung unzuverlässig
 * (bekannt aus dem PATIO-Desktop-Projekt).
 *
 *   node scripts/rauchtest.mjs <benutzername> <passwort>
 */

import http from "node:http";

const [, , BENUTZER, PASSWORT] = process.argv;
if (!BENUTZER || !PASSWORT) {
  console.error("Aufruf: node scripts/rauchtest.mjs <benutzername> <passwort>");
  process.exit(2);
}

const PORT = Number(process.env.API_PORT ?? 3000);
let fehler = 0;

function anfrage(pfad, { methode = "GET", koerper, cookie } = {}) {
  return new Promise((fertig, schiefgegangen) => {
    const daten = koerper ? JSON.stringify(koerper) : null;
    const kopf = {};
    if (daten) {
      kopf["Content-Type"] = "application/json";
      kopf["Content-Length"] = Buffer.byteLength(daten);
    }
    if (cookie) kopf["Cookie"] = cookie;

    const anf = http.request(
      { host: "127.0.0.1", port: PORT, path: pfad, method: methode, headers: kopf },
      (antwort) => {
        let text = "";
        antwort.on("data", (stueck) => (text += stueck));
        antwort.on("end", () =>
          fertig({
            status: antwort.statusCode,
            kopf: antwort.headers,
            text,
            json: (() => {
              try {
                return JSON.parse(text);
              } catch {
                return null;
              }
            })(),
          }),
        );
      },
    );
    anf.on("error", schiefgegangen);
    if (daten) anf.write(daten);
    anf.end();
  });
}

async function pruefe(was, fn) {
  try {
    const meldung = await fn();
    console.log(`  OK   ${was}${meldung ? "  — " + meldung : ""}`);
  } catch (e) {
    fehler++;
    console.log(`  FEHL ${was}\n       ${e instanceof Error ? e.message : e}`);
  }
}

const behaupte = (bedingung, text) => {
  if (!bedingung) throw new Error(text);
};

console.log("\nRauchtest gegen die laufende Anwendung\n");

await pruefe("Gesundheitsprüfung antwortet ohne Anmeldung", async () => {
  const a = await anfrage("/api/health");
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(a.json?.ok === true, "kein ok im Rumpf");
  behaupte(Object.keys(a.json).length === 1, "verrät mehr als nötig: " + a.text);
  return a.text;
});

await pruefe("geschützter Endpunkt weist ohne Anmeldung ab", async () => {
  const a = await anfrage("/api/auth/me");
  behaupte(a.status === 401, `Status ${a.status} statt 401`);
  behaupte(!a.text.includes("benutzername"), "gibt trotzdem Daten preis");
  return "401";
});

await pruefe("Sicherheits-Kopfzeilen sind gesetzt", async () => {
  const a = await anfrage("/api/health");
  const csp = a.kopf["content-security-policy"];
  behaupte(Boolean(csp), "keine Inhaltsrichtlinie");
  behaupte(!a.kopf["content-security-policy-report-only"], "nur berichtend statt erzwingend");
  behaupte(csp.includes("frame-ancestors 'none'"), "Einbetten nicht verboten");
  behaupte(a.kopf["permissions-policy"]?.includes("camera=(self)"), "Kamera-Regel fehlt");
  return "CSP erzwingend, Kamera nur eigene Seite";
});

await pruefe("falsches Passwort wird abgewiesen", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: BENUTZER, passwort: "das-ist-nicht-das-passwort" },
  });
  behaupte(a.status === 401, `Status ${a.status}`);
  behaupte(!a.kopf["set-cookie"], "hat trotzdem ein Cookie gesetzt");
  return a.json?.error;
});

await pruefe("unbekanntes Konto bekommt dieselbe Antwort", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: "gibt-es-sicher-nicht-4711", passwort: "irgendwas" },
  });
  behaupte(a.status === 401, `Status ${a.status}`);
  return a.json?.error;
});

let cookie = null;

await pruefe("richtige Zugangsdaten werden angenommen", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: BENUTZER, passwort: PASSWORT },
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  const gesetzt = a.kopf["set-cookie"]?.[0] ?? "";
  behaupte(gesetzt.includes("gt_sitzung="), "kein Sitzungs-Cookie");
  behaupte(/httponly/i.test(gesetzt), "Cookie ist nicht httpOnly");
  behaupte(gesetzt.includes("SameSite=Strict"), "Cookie ohne SameSite=Strict");
  cookie = gesetzt.split(";")[0];
  return "Cookie httpOnly + SameSite=Strict";
});

await pruefe("angemeldet: eigene Daten abrufbar, ohne Passwort-Hash", async () => {
  const a = await anfrage("/api/auth/me", { cookie });
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(a.json?.benutzer?.benutzername?.toLowerCase() === BENUTZER.toLowerCase(), "falscher Benutzer");
  behaupte(!a.text.includes("argon2"), "Hash steht in der Antwort!");
  return `${a.json.benutzer.anzeigename} (${a.json.benutzer.rolle})`;
});

await pruefe("unbekannter Endpunkt antwortet mit JSON, nicht mit HTML", async () => {
  const a = await anfrage("/api/gibt-es-nicht", { cookie });
  behaupte(a.status === 404, `Status ${a.status}`);
  behaupte(a.kopf["content-type"]?.includes("application/json"), "kein JSON");
  return "404 als JSON";
});

await pruefe("kaputtes JSON ergibt 400, keinen Serverfehler", async () => {
  const a = await new Promise((f, s) => {
    const anf = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: "/api/auth/login",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": 9 },
      },
      (antwort) => {
        let t = "";
        antwort.on("data", (x) => (t += x));
        antwort.on("end", () => f({ status: antwort.statusCode, text: t }));
      },
    );
    anf.on("error", s);
    anf.write("{kaputt:!");
    anf.end();
  });
  behaupte(a.status === 400, `Status ${a.status} statt 400`);
  behaupte(!a.text.includes("SyntaxError"), "verrät Interna");
  return "400 ohne Interna";
});

await pruefe("Abmelden löscht das Cookie", async () => {
  const a = await anfrage("/api/auth/logout", { methode: "POST", cookie });
  behaupte(a.status === 200, `Status ${a.status}`);
  const gesetzt = a.kopf["set-cookie"]?.[0] ?? "";
  behaupte(/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(gesetzt), "Cookie wird nicht gelöscht");
  return "gelöscht";
});

console.log(fehler === 0 ? "\nAlles in Ordnung.\n" : `\n${fehler} Prüfung(en) fehlgeschlagen.\n`);
process.exit(fehler === 0 ? 0 : 1);
