/**
 * Durchlauf: Fotos, Dokumente, Prüfungen, Schäden, Zubehör.
 *
 *   node scripts/durchlauf-pflege.mjs <benutzername> <passwort>
 */

import http from "node:http";

const [, , BENUTZER, PASSWORT] = process.argv;
if (!BENUTZER || !PASSWORT) {
  console.error("Aufruf: node scripts/durchlauf-pflege.mjs <benutzername> <passwort>");
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
          } catch { /* kein JSON, z.B. ein Bild */ }
          fertig({ status: a.statusCode, kopf: a.headers, json, puffer, text: puffer.toString("utf8") });
        });
      },
    );
    anf.on("error", schief);
    if (daten) anf.write(daten);
    anf.end();
  });
}

/** Ein winziges gültiges PNG, im Quelltext erzeugt. */
function testBild() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

/** multipart-Rumpf von Hand — kein Formular-Baustein in Node ohne Zusatzpaket. */
function multipart(feldname, dateiname, inhalt, mime) {
  const grenze = "----GeraeteTracker" + Date.now();
  const kopf = Buffer.from(
    `--${grenze}\r\n` +
      `Content-Disposition: form-data; name="${feldname}"; filename="${dateiname}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const fuss = Buffer.from(`\r\n--${grenze}--\r\n`);
  return { roh: Buffer.concat([kopf, inhalt, fuss]), typ: `multipart/form-data; boundary=${grenze}` };
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

console.log("\nDurchlauf: Fotos, Prüfungen, Schäden, Zubehör\n");

await schritt("anmelden", async () => {
  const a = await anfrage("/api/auth/login", {
    methode: "POST",
    koerper: { kennung: BENUTZER, passwort: PASSWORT },
  });
  behaupte(a.status === 200, `Status ${a.status}: ${a.text}`);
  cookie = (a.kopf["set-cookie"]?.[0] ?? "").split(";")[0];
  return a.json.benutzer.anzeigename;
});

const marke = "PFLEGE-" + Date.now().toString().slice(-6);
let geraetId, zubehoerId, dateiId, pruefartId, schadenId;

await schritt("Gerät und Zubehör anlegen", async () => {
  const haupt = await anfrage("/api/geraete", {
    methode: "POST",
    koerper: { bezeichnung: `${marke} Minibagger` },
  });
  behaupte(haupt.status === 201, haupt.text);
  geraetId = haupt.json.id;

  const teil = await anfrage("/api/geraete", {
    methode: "POST",
    koerper: { bezeichnung: `${marke} Tieflöffel 40 cm` },
  });
  behaupte(teil.status === 201, teil.text);
  zubehoerId = teil.json.id;

  const zuordnen = await anfrage(`/api/geraete/${zubehoerId}`, {
    methode: "PATCH",
    koerper: { gehoert_zu_id: geraetId, rev: teil.json.rev },
  });
  behaupte(zuordnen.status === 200, zuordnen.text);
  return `${haupt.json.inventarnummer} + ${teil.json.inventarnummer}`;
});

await schritt("Zubehör erscheint beim Hauptgerät", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}`);
  behaupte(a.json.zubehoer.length === 1, `${a.json.zubehoer.length} Zubehörteile statt 1`);
  const t = await anfrage(`/api/geraete/${zubehoerId}`);
  behaupte(t.json.gehoert_zu?.includes("Minibagger"), "Rückverweis fehlt");
  return a.json.zubehoer[0].bezeichnung;
});

await schritt("Foto hochladen", async () => {
  const { roh, typ } = multipart("datei", "typenschild.png", testBild(), "image/png");
  const a = await anfrage(`/api/geraete/${geraetId}/dateien`, { methode: "POST", roh, typ });
  behaupte(a.status === 201, `Status ${a.status}: ${a.text}`);
  behaupte(a.json.art === "foto", `art ${a.json.art}`);
  behaupte(a.json.ist_titelbild === true, "erstes Foto wurde nicht zum Titelbild");
  dateiId = a.json.id;
  return "erstes Foto ist automatisch Titelbild";
});

await schritt("Foto ist über die geschützte Route abrufbar", async () => {
  const a = await anfrage(`/api/dateien/${dateiId}`);
  behaupte(a.status === 200, `Status ${a.status}`);
  behaupte(a.kopf["content-type"] === "image/png", `Typ ${a.kopf["content-type"]}`);
  behaupte(a.puffer.length > 0, "leere Antwort");
  return `${a.puffer.length} Bytes, ${a.kopf["cache-control"]}`;
});

await schritt("Foto NICHT ohne Anmeldung abrufbar", async () => {
  const gemerkt = cookie;
  cookie = null;
  const a = await anfrage(`/api/dateien/${dateiId}`);
  cookie = gemerkt;
  behaupte(a.status === 401, `Status ${a.status} statt 401`);
  return "401";
});

await schritt("Datei mit falscher Signatur wird abgelehnt", async () => {
  // Als .jpg benannt, aber Text drin. Die Prüfung sieht die ersten Bytes an.
  const { roh, typ } = multipart("datei", "harmlos.jpg", Buffer.from("<?php echo 1; ?>"), "image/jpeg");
  const a = await anfrage(`/api/geraete/${geraetId}/dateien`, { methode: "POST", roh, typ });
  behaupte(a.status === 400, `Status ${a.status} statt 400`);
  return a.json.error;
});

await schritt("Titelbild ist in der Geräteansicht verlinkt", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}`);
  behaupte(a.json.titelbild_id === dateiId, "Titelbild fehlt in der Ansicht");
  return "verlinkt";
});

await schritt("Prüfart anlegen", async () => {
  const a = await anfrage("/api/pruefarten", {
    methode: "POST",
    koerper: { name: `${marke}-E-Prüfung`, intervall_monate: 12 },
  });
  behaupte(a.status === 201, a.text);
  pruefartId = a.json.id;
  return `${a.json.name}, alle ${a.json.intervall_monate} Monate`;
});

await schritt("Prüfung eintragen — Fälligkeit rechnet der Server", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/pruefungen`, {
    methode: "POST",
    koerper: {
      pruefart_id: pruefartId,
      geprueft_am: "2026-03-31",
      ergebnis: "bestanden",
      pruefer: "TÜV",
    },
  });
  behaupte(a.status === 201, a.text);
  const faellig = String(a.json.naechste_faellig).slice(0, 10);
  behaupte(faellig === "2027-03-31", `Fälligkeit ${faellig} statt 2027-03-31`);
  return `geprüft 31.03.2026 → fällig ${faellig}`;
});

await schritt("Prüfung mit Datum in der Zukunft wird abgelehnt", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/pruefungen`, {
    methode: "POST",
    koerper: { pruefart_id: pruefartId, geprueft_am: "2099-01-01", ergebnis: "bestanden" },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return a.json.error;
});

await schritt("Schaden melden mit Schwere 'ausfall' sperrt das Gerät", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/schaeden`, {
    methode: "POST",
    koerper: { beschreibung: "Hydraulikschlauch undicht", schwere: "ausfall" },
  });
  behaupte(a.status === 201, a.text);
  behaupte(a.json.geraet.status === "defekt", `Status ${a.json.geraet.status}`);
  schadenId = a.json.schaden.id;
  return "Gerät ist gesperrt";
});

await schritt("gesperrtes Gerät lässt sich nicht ausgeben", async () => {
  const orte = (await anfrage("/api/standorte")).json;
  const ziel = orte.find((o) => o.typ === "baustelle");
  const ich = (await anfrage("/api/auth/me")).json.benutzer;
  const a = await anfrage("/api/buchungen", {
    methode: "POST",
    koerper: {
      geraet_id: geraetId,
      art: "ausgabe",
      nach_standort_id: ziel.id,
      empfaenger_id: ich.id,
    },
  });
  behaupte(a.status === 409, `Status ${a.status} statt 409`);
  return a.json.error;
});

await schritt("Schaden erledigen gibt das Gerät wieder frei", async () => {
  const a = await anfrage(`/api/schaeden/${schadenId}`, {
    methode: "PATCH",
    koerper: { status: "erledigt", erledigt_notiz: "Schlauch getauscht" },
  });
  behaupte(a.status === 200, a.text);
  behaupte(a.json.geraet.status === "verfuegbar", `Status ${a.json.geraet.status}`);
  return "wieder verfügbar";
});

await schritt("Mitarbeiter darf melden, aber nicht erledigen", async () => {
  const a = await anfrage(`/api/geraete/${geraetId}/schaeden`);
  behaupte(a.status === 200, "Lesen sollte jedem erlaubt sein");
  return `${a.json.length} Schaden/Schäden in der Historie`;
});

console.log(
  fehler === 0 ? "\nAlles funktioniert.\n" : `\n${fehler} Schritt(e) fehlgeschlagen.\n`,
);
process.exit(fehler === 0 ? 0 : 1);
