/**
 * Durchlauf gegen die laufende Anwendung: der Weg, den Julius im Büro
 * tatsächlich gehen wird — Standort anlegen, Regal etikettieren, Gerät
 * erfassen, Ersatzetikett aufkleben, Stammdaten korrigieren.
 *
 * node:http statt fetch(), siehe rauchtest.mjs.
 *
 *   node scripts/durchlauf.mjs <benutzername> <passwort>
 */

import http from "node:http";

const [, , BENUTZER, PASSWORT] = process.argv;
if (!BENUTZER || !PASSWORT) {
  console.error("Aufruf: node scripts/durchlauf.mjs <benutzername> <passwort>");
  process.exit(2);
}

const PORT = Number(process.env.API_PORT ?? 3000);
let cookie = null;
let fehler = 0;

function anfrage(pfad, { methode = "GET", koerper } = {}) {
  return new Promise((fertig, schief) => {
    const daten = koerper ? JSON.stringify(koerper) : null;
    const kopf = {};
    if (daten) {
      kopf["Content-Type"] = "application/json";
      kopf["Content-Length"] = Buffer.byteLength(daten);
    }
    if (cookie) kopf["Cookie"] = cookie;
    const anf = http.request(
      { host: "127.0.0.1", port: PORT, path: pfad, method: methode, headers: kopf },
      (a) => {
        let t = "";
        a.on("data", (x) => (t += x));
        a.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(t);
          } catch { /* kein JSON */ }
          fertig({ status: a.statusCode, kopf: a.headers, text: t, json });
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

console.log("\nDurchlauf: der Weg im Büro\n");

await schritt("anmelden", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: BENUTZER, passwort: PASSWORT },
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  cookie = (a.kopf["set-cookie"]?.[0] ?? "").split(";")[0];
  return a.json.benutzer.anzeigename;
});

const marke = "DURCHLAUF-" + Date.now().toString().slice(-6);
let standortId, platzCode, geraetId, geraetRev, geraetNummer;

await schritt("Baustelle anlegen", async () => {
  const a = await anfrage("/api/standorte", {
    methode: "POST",
    koerper: { name: `${marke} Lindengasse`, typ: "baustelle", adresse: "Lindengasse 1, Wien" },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  standortId = a.json.id;
  return a.json.name;
});

await schritt("Regal anlegen — Kennung wird von selbst vergeben", async () => {
  const a = await anfrage("/api/lagerplaetze", {
    methode: "POST",
    koerper: { standort_id: standortId, bezeichnung: `${marke} Regal C3`, typ: "regal" },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  behaupte(/^P-\d{4}$/.test(a.json.barcode), `unerwartete Kennung ${a.json.barcode}`);
  platzCode = a.json.barcode;
  return `${a.json.bezeichnung} → Etikett ${platzCode}`;
});

await schritt("Schlagwort anlegen", async () => {
  const a = await anfrage("/api/schlagworte", {
    methode: "POST",
    koerper: { name: `${marke}-Verdichtung`, farbe: "#1d4ed8" },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  return a.json.name;
});

await schritt("Gerät erfassen — Nummer wird fortlaufend vergeben", async () => {
  const a = await anfrage("/api/geraete", {
    methode: "POST",
    koerper: {
      bezeichnung: `${marke} Rüttelplatte`,
      hersteller: "Wacker Neuson",
      modell: "DPU 6555",
      seriennummer: "SN-4711",
      standort_id: standortId,
    },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  behaupte(/^\d{5}$/.test(a.json.inventarnummer), `unerwartete Nummer ${a.json.inventarnummer}`);
  geraetId = a.json.id;
  geraetRev = a.json.rev;
  geraetNummer = a.json.inventarnummer;
  return `Nummer ${geraetNummer}`;
});

await schritt("Etikett wurde mit angelegt", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/barcodes`);
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(a.json.length === 1, `${a.json.length} Etiketten statt 1`);
  behaupte(a.json[0].barcode === geraetNummer, "Etikett trägt eine andere Nummer");
  return a.json[0].barcode;
});

await schritt("Ersatzetikett aufkleben — das alte bleibt gültig", async () => {
  const ersatz = String(Number(geraetNummer) + 50000);
  const a = await anfrage(`/api/geraete/${geraetId}/barcodes`, {
    methode: "POST",
    koerper: { barcode: ersatz },
  });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  const alle = await anfrage(`/api/geraete/${geraetId}/barcodes`);
  behaupte(alle.json.length === 2, "das alte Etikett wurde entwertet");
  behaupte(alle.json.every((b) => b.aktiv), "ein Etikett ist nicht mehr gültig");
  return `${geraetNummer} + ${ersatz}, beide gültig`;
});

await schritt("Regal-Kennung wird nicht als Geräte-Etikett angenommen", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/barcodes`, {
    methode: "POST",
    koerper: { barcode: platzCode },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return "getrennte Nummernkreise greifen";
});

await schritt("Stammdaten korrigieren", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}`, {
    methode: "PATCH",
    koerper: { bezeichnung: `${marke} Rüttelplatte 600 kg`, rev: geraetRev },
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  behaupte(a.json.rev === geraetRev + 1, "Fassungszähler nicht erhöht");
  geraetRev = a.json.rev;
  return `Fassung ${geraetRev}`;
});

await schritt("zweiter Bearbeiter mit veralteter Fassung wird abgewiesen", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}`, {
    methode: "PATCH",
    koerper: { bezeichnung: `${marke} überschrieben`, rev: geraetRev - 1 },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  behaupte(a.json.konflikt === true, "kein Konflikt-Hinweis");
  behaupte(a.json.aktuell?.bezeichnung?.includes("600 kg"), "aktueller Stand fehlt in der Antwort");
  return "409 samt aktuellem Stand";
});

await schritt("Bestand am Standort abfragen", async () => {
  const a = await anfrage(`/api/standorte/${standortId}/bestand`);
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(a.json.geraete.length === 1, `${a.json.geraete.length} Geräte statt 1`);
  return `${a.json.standort.name}: ${a.json.geraete[0].bezeichnung}`;
});

await schritt("letztes Etikett lässt sich nicht stilllegen", async () => {
  const ersatz = String(Number(geraetNummer) + 50000);
  const weg1 = await anfrage(`/api/geraete/${geraetId}/barcodes/${geraetNummer}`, {
    methode: "DELETE",
  });
  behaupte(weg1.status === 200, `erstes Stilllegen: Status ${weg1.status}`);
  const weg2 = await anfrage(`/api/geraete/${geraetId}/barcodes/${ersatz}`, { methode: "DELETE" });
  behaupte(weg2.status === 409, `Status ${weg2.status} statt 409`);
  return "Gerät bleibt scanbar";
});

await schritt("ausmustern statt löschen", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/ausmustern`, { methode: "POST" });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  behaupte(a.json.status === "ausgemustert", `Status ${a.json.status}`);
  const liste = await anfrage("/api/geraete");
  behaupte(!liste.json.some((g) => g.id === geraetId), "steht noch in der normalen Liste");
  return "aus der Liste, aber in der Datenbank";
});

console.log(
  fehler === 0 ? "\nDer ganze Weg funktioniert.\n" : `\n${fehler} Schritt(e) fehlgeschlagen.\n`,
);
process.exit(fehler === 0 ? 0 : 1);
