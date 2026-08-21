/**
 * Durchlauf: der Weg der Bestandserfassung, gegen die laufende Anwendung.
 *
 * Anlegen → exportieren → Datei so verändern, wie Excel es täte →
 * Vorschau → importieren → prüfen, dass alles ankam und Standort und
 * Zustand unangetastet blieben.
 *
 *   node scripts/durchlauf-erfassung.mjs <benutzername> <passwort>
 */

import http from "node:http";

const [, , BENUTZER, PASSWORT] = process.argv;
if (!BENUTZER || !PASSWORT) {
  console.error("Aufruf: node scripts/durchlauf-erfassung.mjs <benutzername> <passwort>");
  process.exit(2);
}

const PORT = Number(process.env.API_PORT ?? 3000);
let cookie = null;
let fehler = 0;

function anfrage(pfad, { methode = "GET", koerper, roh, typ } = {}) {
  return new Promise((fertig, schief) => {
    const daten = roh ?? (koerper ? Buffer.from(JSON.stringify(koerper)) : null);
    const kopf = {};
    if (daten) {
      kopf["Content-Type"] = typ ?? "application/json";
      kopf["Content-Length"] = daten.length;
    }
    if (cookie) kopf["Cookie"] = cookie;
    const anf = http.request(
      { host: "127.0.0.1", port: PORT, path: pfad, method: methode, headers: kopf },
      (a) => {
        const stuecke = [];
        a.on("data", (x) => stuecke.push(x));
        a.on("end", () => {
          const puffer = Buffer.concat(stuecke);
          let json = null;
          try {
            json = JSON.parse(puffer.toString("utf8"));
          } catch { /* kein JSON */ }
          fertig({ status: a.statusCode, kopf: a.headers, json, puffer, text: puffer.toString("utf8") });
        });
      },
    );
    anf.on("error", schief);
    if (daten) anf.write(daten);
    anf.end();
  });
}

/** CSV-Datei als multipart, wie ein Browser sie schickt. */
function alsDatei(inhalt) {
  const grenze = "----Erfassung" + Date.now();
  const bytes = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt, "utf8");
  const kopf = Buffer.from(
    `--${grenze}\r\n` +
      `Content-Disposition: form-data; name="datei"; filename="bestand.csv"\r\n` +
      `Content-Type: text/csv\r\n\r\n`,
  );
  const fuss = Buffer.from(`\r\n--${grenze}--\r\n`);
  return { roh: Buffer.concat([kopf, bytes, fuss]), typ: `multipart/form-data; boundary=${grenze}` };
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

console.log("\nDurchlauf: Bestandserfassung\n");

await schritt("anmelden", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: BENUTZER, passwort: PASSWORT },
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  cookie = (a.kopf["set-cookie"]?.[0] ?? "").split(";")[0];
  return a.json.benutzer.anzeigename;
});

const marke = "ERF-" + Date.now().toString().slice(-6);
let nummerRuettler;

await schritt("Gerät über die API anlegen (wie in der Oberfläche)", async () => {
  const a = await anfrage("/api/geraete", {
    methode: "POST",
    koerper: { bezeichnung: `${marke} Rüttelplatte`, hersteller: "Wacker Neuson" },
  });
  behaupte(a.status === 201, a.text);
  nummerRuettler = a.json.inventarnummer;
  return `Nummer ${nummerRuettler}`;
});

await schritt("20 gleichzeitige Anlagen bekommen verschiedene Nummern", async () => {
  // Der Fall, für den die Nummernsperre gebaut wurde.
  const alle = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      anfrage("/api/geraete", {
        methode: "POST",
        koerper: { bezeichnung: `${marke} Gleichzeitig ${i}` },
      }),
    ),
  );
  const fehlgeschlagen = alle.filter((a) => a.status !== 201);
  behaupte(fehlgeschlagen.length === 0, `${fehlgeschlagen.length} Anlagen schlugen fehl`);
  const nummern = new Set(alle.map((a) => a.json.inventarnummer));
  behaupte(nummern.size === 20, `nur ${nummern.size} verschiedene Nummern`);
  return "20 von 20, alle verschieden";
});

let exportiert;

await schritt("Export herunterladen", async () => {
  const a = await anfrage("/api/export/geraete.csv");
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(
    a.puffer[0] === 0xef && a.puffer[1] === 0xbb && a.puffer[2] === 0xbf,
    "kein BOM — Excel würde die Umlaute zerschießen",
  );
  exportiert = a.puffer.toString("utf8");
  behaupte(exportiert.includes("Inventarnummer;Bezeichnung"), "falsches Trennzeichen");
  behaupte(exportiert.includes("Fassung"), "Fassungsspalte fehlt");
  behaupte(exportiert.includes("(nur Information)"), "Zustandsspalten nicht gekennzeichnet");
  return `${exportiert.split("\r\n").length - 2} Zeilen, mit BOM und Semikolon`;
});

await schritt("Datei wie in Excel bearbeiten und wieder einlesen", async () => {
  // Bezeichnung ändern, Hersteller leeren (darf NICHTS löschen)
  const geaendert = exportiert
    .replace(`${marke} Rüttelplatte;Wacker Neuson`, `${marke} Rüttelplatte 600 kg;`)
    .replace(/\uFEFF/, ""); // Excel schreibt das BOM neu, hier egal

  const vorschau = await anfrage("/api/import/geraete/pruefen", {
    methode: "POST",
    ...alsDatei(geaendert),
  });
  behaupte(vorschau.status === 200, vorschau.text);
  behaupte(vorschau.json.schreibbar === true, "Vorschau meldet nicht schreibbar");
  behaupte(vorschau.json.geaendert >= 1, "keine Änderung erkannt");

  const geschrieben = await anfrage("/api/import/geraete", {
    methode: "POST",
    ...alsDatei(geaendert),
  });
  behaupte(geschrieben.status === 200, geschrieben.text);
  return `${geschrieben.json.geaendert} geändert, ${geschrieben.json.uebersprungen} unverändert`;
});

await schritt("Bezeichnung kam an, Hersteller blieb stehen", async () => {
  const alle = (await anfrage("/api/geraete")).json;
  const g = alle.find((x) => x.inventarnummer === nummerRuettler);
  behaupte(g, "Gerät nicht gefunden");
  behaupte(g.bezeichnung.includes("600 kg"), `Bezeichnung ist "${g.bezeichnung}"`);
  // DAS ist Julius' Vorgabe: eine leere Zelle löscht nichts.
  behaupte(
    g.hersteller === "Wacker Neuson",
    `Hersteller wurde gelöscht (steht: ${g.hersteller}) — leere Zelle darf das nicht`,
  );
  return "leere Zelle hat nichts gelöscht";
});

await schritt("unvollständige Zeilen werden angelegt", async () => {
  const nurBezeichnung = `Bezeichnung\r\n${marke} Nur Name eins\r\n${marke} Nur Name zwei\r\n`;
  const a = await anfrage("/api/import/geraete", { methode: "POST", ...alsDatei(nurBezeichnung) });
  behaupte(a.status === 200, a.text);
  behaupte(a.json.angelegt === 2, `${a.json.angelegt} statt 2 angelegt`);
  return "Datei mit einer einzigen Spalte genügt";
});

await schritt("eine fehlerhafte Zeile verhindert den GANZEN Import", async () => {
  const vorher = (await anfrage("/api/geraete")).json.length;
  const kaputt =
    `Bezeichnung;Anschaffungswert\r\n` +
    `${marke} Wird nicht angelegt;100\r\n` +
    `${marke} Kaputt;ca. dreitausend\r\n`;
  const a = await anfrage("/api/import/geraete", { methode: "POST", ...alsDatei(kaputt) });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  const nachher = (await anfrage("/api/geraete")).json.length;
  behaupte(nachher === vorher, "es wurde trotzdem etwas geschrieben");
  return "nichts geschrieben, auch nicht die gute Zeile davor";
});

await schritt("Standort aus der Datei bleibt wirkungslos", async () => {
  const mitOrt =
    `Inventarnummer;Bezeichnung;Standort (nur Information);Status (nur Information)\r\n` +
    `${nummerRuettler};${marke} Rüttelplatte 600 kg;Irgendwo;ausgegeben\r\n`;
  const a = await anfrage("/api/import/geraete/pruefen", { methode: "POST", ...alsDatei(mitOrt) });
  behaupte(a.json.unveraendert === 1, "Zustandsspalten wurden als Änderung gewertet");
  behaupte(
    a.json.hinweise.join(" ").includes("Standort und Zustand"),
    "kein Hinweis auf die wirkungslosen Spalten",
  );

  const alle = (await anfrage("/api/geraete")).json;
  const g = alle.find((x) => x.inventarnummer === nummerRuettler);
  behaupte(g.status === "verfuegbar", `Status wurde geändert: ${g.status}`);
  return "Zustand entsteht weiterhin nur aus Buchungen";
});

await schritt("Änderung nach dem Export wird als Konflikt gemeldet", async () => {
  // Der gefährlichste Fall: Datei von Montag, Änderung am Dienstag.
  const alle = (await anfrage("/api/geraete")).json;
  const g = alle.find((x) => x.inventarnummer === nummerRuettler);

  await anfrage(`/api/geraete/${g.id}`, {
    methode: "PATCH",
    koerper: { bezeichnung: `${marke} In der App geändert`, rev: g.rev },
  });

  // Die alte Datei kennt die neue Fassung nicht.
  const alteDatei =
    `Inventarnummer;Bezeichnung;Fassung\r\n` +
    `${nummerRuettler};${marke} Aus der alten Datei;${g.rev}\r\n`;
  const a = await anfrage("/api/import/geraete", { methode: "POST", ...alsDatei(alteDatei) });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);

  const danach = (await anfrage("/api/geraete")).json.find(
    (x) => x.inventarnummer === nummerRuettler,
  );
  behaupte(
    danach.bezeichnung.includes("In der App geändert"),
    "die Änderung aus der App wurde überschrieben",
  );
  return "Änderung in der App blieb erhalten";
});

console.log(fehler === 0 ? "\nDer ganze Weg funktioniert.\n" : `\n${fehler} Schritt(e) fehlgeschlagen.\n`);
process.exit(fehler === 0 ? 0 : 1);
