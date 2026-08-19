/**
 * Durchlauf: Benutzerverwaltung, gegen die laufende Anwendung.
 *
 * Konto anlegen → mit dem Einmalpasswort anmelden → Wechsel wird erzwungen →
 * als Mitarbeiter scheitert eine Verwaltungsaktion mit 403 → hochstufen →
 * dieselbe Aktion gelingt → Aussperr-Sperren auslösen.
 *
 * Die Testsuite läuft im selben Prozess wie die App und würde nicht merken,
 * wenn der gebaute Server gar nicht startet — deshalb dieser Weg über HTTP.
 *
 *   node scripts/durchlauf-benutzer.mjs <benutzername> <passwort>
 */

import http from "node:http";

const [, , BENUTZER, PASSWORT] = process.argv;
if (!BENUTZER || !PASSWORT) {
  console.error("Aufruf: node scripts/durchlauf-benutzer.mjs <benutzername> <passwort>");
  process.exit(2);
}

const PORT = Number(process.env.API_PORT ?? 3000);
let cookie = null;
let fehler = 0;

function anfrage(pfad, { methode = "GET", koerper, mitCookie = cookie } = {}) {
  return new Promise((fertig, schief) => {
    const daten = koerper ? Buffer.from(JSON.stringify(koerper)) : null;
    const kopf = {};
    if (daten) {
      kopf["Content-Type"] = "application/json";
      kopf["Content-Length"] = daten.length;
    }
    if (mitCookie) kopf["Cookie"] = mitCookie;
    const anf = http.request(
      { host: "127.0.0.1", port: PORT, path: pfad, method: methode, headers: kopf },
      (a) => {
        const stuecke = [];
        a.on("data", (x) => stuecke.push(x));
        a.on("end", () => {
          const text = Buffer.concat(stuecke).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* kein JSON */
          }
          fertig({ status: a.statusCode, kopf: a.headers, json, text });
        });
      },
    );
    anf.on("error", schief);
    if (daten) anf.write(daten);
    anf.end();
  });
}

async function schritt(was, fn) {
  try {
    const meldung = await fn();
    console.log(`  OK   ${was}${meldung ? "  — " + meldung : ""}`);
  } catch (e) {
    fehler++;
    console.log(`  FEHL ${was}\n       ${e instanceof Error ? e.message : e}`);
  }
}
const behaupte = (b, t) => {
  if (!b) throw new Error(t);
};

console.log("\nDurchlauf: Benutzerverwaltung\n");

const kennung = "durchlauf-" + Math.random().toString(36).slice(2, 8);
let neuId = null;
let einmalpasswort = null;
let neuCookie = null;

await schritt("Anmeldung als Verwaltung", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: BENUTZER, passwort: PASSWORT },
    mitCookie: null,
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text.slice(0, 160)}`);
  cookie = (a.kopf["set-cookie"]?.[0] ?? "").split(";")[0];
  behaupte(cookie, "kein Sitzungs-Cookie");
  const rechte = a.json?.rechte ?? [];
  behaupte(
    rechte.includes("benutzer.verwalten"),
    "Dieses Konto darf keine Benutzer verwalten — der Durchlauf braucht ein Verwaltungskonto.",
  );
  return `${rechte.length} Rechte`;
});

await schritt("Rechte-Katalog abrufen", async () => {
  const a = await anfrage("/api/rechte");
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(a.json.rechte.length >= 13, `nur ${a.json.rechte.length} Rechte`);
  return `${a.json.rechte.length} Rechte in ${a.json.gruppen.length} Gruppen`;
});

await schritt("Konto anlegen", async () => {
  const a = await anfrage("/api/benutzer", {
    methode: "POST",
    koerper: {
      benutzername: kennung,
      anzeigename: "Durchlauf Testkonto",
      rolle: "mitarbeiter",
    },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text.slice(0, 160)}`);
  neuId = a.json.benutzer.id;
  einmalpasswort = a.json.einmalpasswort;
  behaupte(einmalpasswort?.length >= 12, "kein brauchbares Einmalpasswort");
  return `${kennung}, Passwort ${einmalpasswort}`;
});

await schritt("Anmeldung mit dem Einmalpasswort erzwingt den Wechsel", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung, passwort: einmalpasswort },
    mitCookie: null,
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text.slice(0, 160)}`);
  behaupte(a.json.passwortWechselNoetig === true, "Wechsel wird nicht verlangt");
  neuCookie = (a.kopf["set-cookie"]?.[0] ?? "").split(";")[0];
  return "passwortWechselNoetig = true";
});

await schritt("Als Mitarbeiter scheitert das Anlegen eines Geräts mit 403", async () => {
  const a = await anfrage("/api/geraete", {
    methode: "POST",
    koerper: { bezeichnung: "Durchlauf-Gerät" },
    mitCookie: neuCookie,
  });
  behaupte(a.status === 403, `Status ${a.status} statt 403`);
  return a.json?.error?.slice(0, 60);
});

await schritt("Als Mitarbeiter zeigt die Benutzerliste keine Rollen", async () => {
  const a = await anfrage("/api/benutzer", { mitCookie: neuCookie });
  behaupte(a.status === 200, `Status ${a.status}`);
  const erster = a.json[0] ?? {};
  behaupte(erster.rolle === undefined, "Die Kurzliste verrät die Rolle");
  behaupte(erster.email === undefined, "Die Kurzliste verrät die E-Mail");
  return `${a.json.length} Namen, ohne Rolle und E-Mail`;
});

await schritt("Hochstufen auf 'lager'", async () => {
  const a = await anfrage(`/api/benutzer/${neuId}`, {
    methode: "PATCH",
    koerper: { rolle: "lager" },
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text.slice(0, 160)}`);
  return "Rolle geändert";
});

await schritt("Der Rollenwechsel hat die Sitzung beendet", async () => {
  const a = await anfrage("/api/geraete", { mitCookie: neuCookie });
  behaupte(a.status === 401, `Status ${a.status} statt 401 — das alte Cookie gilt noch`);
  return "altes Cookie abgewiesen";
});

await schritt("Nach neuer Anmeldung gelingt dieselbe Aktion", async () => {
  const an = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung, passwort: einmalpasswort },
    mitCookie: null,
  });
  behaupte(an.status === 200, `Anmeldung: Status ${an.status}`);
  neuCookie = (an.kopf["set-cookie"]?.[0] ?? "").split(";")[0];

  const a = await anfrage("/api/geraete", {
    methode: "POST",
    koerper: { bezeichnung: "Durchlauf-Gerät" },
    mitCookie: neuCookie,
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text.slice(0, 160)}`);
  // Wieder wegräumen — dieser Durchlauf soll keinen Bestand hinterlassen.
  await anfrage(`/api/geraete/${a.json.id}`, {
    methode: "PATCH",
    koerper: { status: "ausgemustert", rev: a.json.rev },
  });
  return "Gerät angelegt";
});

await schritt("Eigene Rolle lässt sich nicht ändern", async () => {
  const ich = await anfrage("/api/auth/me");
  const a = await anfrage(`/api/benutzer/${ich.json.benutzer.id}`, {
    methode: "PATCH",
    koerper: { rolle: "mitarbeiter" },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return a.json?.error?.slice(0, 60);
});

await schritt("Eigenes Konto lässt sich nicht stilllegen", async () => {
  const ich = await anfrage("/api/auth/me");
  const a = await anfrage(`/api/benutzer/${ich.json.benutzer.id}`, {
    methode: "PATCH",
    koerper: { aktiv: false },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return "abgewiesen";
});

await schritt("Mitgelieferte Rolle lässt ihre Rechte nicht ändern", async () => {
  const a = await anfrage("/api/rollen/verwaltung", {
    methode: "PATCH",
    koerper: { rechte: ["buchungen.erfassen"] },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return a.json?.error?.slice(0, 60);
});

await schritt("Eigene Rolle anlegen, zuweisen und wieder aufräumen", async () => {
  const rollenId = "durchlauf-leser";
  await anfrage(`/api/rollen/${rollenId}`, { methode: "DELETE" }); // Rest vom letzten Lauf

  const neu = await anfrage("/api/rollen", {
    methode: "POST",
    koerper: { id: rollenId, name: "Durchlauf Leser", rechte: [] },
  });
  behaupte(neu.status === 201, `Anlegen: Status ${neu.status}: ${neu.text.slice(0, 160)}`);

  const zu = await anfrage(`/api/benutzer/${neuId}`, {
    methode: "PATCH",
    koerper: { rolle: rollenId },
  });
  behaupte(zu.status === 200, `Zuweisen: Status ${zu.status}`);

  const belegt = await anfrage(`/api/rollen/${rollenId}`, { methode: "DELETE" });
  behaupte(belegt.status === 409, `Belegte Rolle löschbar: Status ${belegt.status}`);

  await anfrage(`/api/benutzer/${neuId}`, { methode: "PATCH", koerper: { rolle: "mitarbeiter" } });
  const weg = await anfrage(`/api/rollen/${rollenId}`, { methode: "DELETE" });
  behaupte(weg.status === 200, `Löschen: Status ${weg.status}`);
  return "angelegt, zugewiesen, gesperrt, gelöscht";
});

await schritt("Testkonto stilllegen", async () => {
  const a = await anfrage(`/api/benutzer/${neuId}`, {
    methode: "PATCH",
    koerper: { aktiv: false },
  });
  behaupte(a.status === 200, `Status ${a.status}`);
  return `${kennung} stillgelegt (Konten werden nie gelöscht — die Historie bleibt)`;
});

console.log(
  fehler === 0
    ? "\nAlle Schritte in Ordnung.\n"
    : `\n${fehler} Schritt(e) fehlgeschlagen.\n`,
);
process.exit(fehler === 0 ? 0 : 1);
