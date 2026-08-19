/**
 * Legt Beispieldaten an, damit sich die Oberfläche ansehen lässt.
 * NUR für die Entwicklung — alles trägt "Beispiel" im Namen und ist
 * damit wieder auffindbar und löschbar.
 *
 *   node scripts/beispieldaten.mjs <benutzername> <passwort>
 */

import http from "node:http";

const [, , BENUTZER, PASSWORT] = process.argv;
if (!BENUTZER || !PASSWORT) {
  console.error("Aufruf: node scripts/beispieldaten.mjs <benutzername> <passwort>");
  process.exit(2);
}

const PORT = Number(process.env.API_PORT ?? 3000);
let cookie = null;

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
          fertig({ status: a.statusCode, kopf: a.headers, json, text: t });
        });
      },
    );
    anf.on("error", schief);
    if (daten) anf.write(daten);
    anf.end();
  });
}

const an = await anfrage("/api/auth/login", {
  methode: "POST",
  koerper: { kennung: BENUTZER, passwort: PASSWORT },
});
if (an.status !== 200) {
  console.error("Anmeldung fehlgeschlagen:", an.text);
  process.exit(1);
}
cookie = (an.kopf["set-cookie"]?.[0] ?? "").split(";")[0];
const ichId = (await anfrage("/api/auth/me")).json.benutzer.id;

// ── Orte ────────────────────────────────────────────────────────────────────
const orte = {};
for (const [schluessel, daten] of Object.entries({
  bauhof: { name: "Bauhof Nord", typ: "lager", adresse: "Gewerbestraße 12" },
  lindengasse: { name: "Baustelle Lindengasse", typ: "baustelle", adresse: "Lindengasse 4, 1070 Wien" },
  ahornweg: { name: "Baustelle Ahornweg", typ: "baustelle", adresse: "Ahornweg 22, 2340 Mödling" },
  werkstatt: { name: "Werkstatt", typ: "werkstatt" },
})) {
  const a = await anfrage("/api/standorte", { methode: "POST", koerper: daten });
  if (a.status === 201) orte[schluessel] = a.json.id;
  else {
    const alle = (await anfrage("/api/standorte")).json;
    orte[schluessel] = alle.find((s) => s.name === daten.name)?.id;
  }
}

// ── Regale ──────────────────────────────────────────────────────────────────
const regale = [];
for (const bez of ["Regal A1", "Regal A2", "Regal B1", "Container 1"]) {
  const a = await anfrage("/api/lagerplaetze", {
    methode: "POST",
    koerper: { standort_id: orte.bauhof, bezeichnung: bez, typ: bez.startsWith("C") ? "container" : "regal" },
  });
  if (a.status === 201) regale.push(a.json);
}

// ── Schlagworte ─────────────────────────────────────────────────────────────
const worte = {};
for (const [name, farbe] of Object.entries({
  Verdichtung: "#b45309",
  Erdbau: "#15803d",
  Messtechnik: "#1d4ed8",
  Mietgerät: "#b91c1c",
  Kleingerät: null,
})) {
  const a = await anfrage("/api/schlagworte", { methode: "POST", koerper: { name, farbe } });
  if (a.status === 201) worte[name] = a.json.id;
}

// ── Geräte ──────────────────────────────────────────────────────────────────
const KATALOG = [
  { bezeichnung: "Rüttelplatte 600 kg", hersteller: "Wacker Neuson", modell: "DPU 6555", worte: ["Verdichtung"] },
  { bezeichnung: "Vibrationsstampfer", hersteller: "Wacker Neuson", modell: "BS 60-4", worte: ["Verdichtung", "Kleingerät"] },
  { bezeichnung: "Minibagger 1,8 t", hersteller: "Kubota", modell: "KX019-4", worte: ["Erdbau", "Mietgerät"] },
  { bezeichnung: "Rotationslaser", hersteller: "Leica", modell: "Rugby 620", worte: ["Messtechnik"] },
  { bezeichnung: "Nivelliergerät", hersteller: "Bosch", modell: "GOL 26 D", worte: ["Messtechnik", "Kleingerät"] },
  { bezeichnung: "Trennschleifer 350 mm", hersteller: "Stihl", modell: "TS 420", worte: ["Kleingerät"] },
  { bezeichnung: "Bohrhammer SDS-Max", hersteller: "Hilti", modell: "TE 70-ATC", worte: ["Kleingerät"] },
  { bezeichnung: "Stromerzeuger 5 kVA", hersteller: "Honda", modell: "EU 50is", worte: [] },
  { bezeichnung: "Bautrockner", hersteller: "Trotec", modell: "TTK 350 S", worte: ["Mietgerät"] },
  { bezeichnung: "Baustellenkreissäge", hersteller: "Metabo", modell: "KGS 216", worte: ["Kleingerät"] },
  { bezeichnung: "Kernbohrgerät", hersteller: "Hilti", modell: "DD 150-U", worte: [] },
  { bezeichnung: "Rüttelflasche", hersteller: "Wacker Neuson", modell: "IRFU 45", worte: ["Verdichtung"] },
];

const angelegt = [];
for (const eintrag of KATALOG) {
  const a = await anfrage("/api/geraete", {
    methode: "POST",
    koerper: {
      bezeichnung: eintrag.bezeichnung,
      hersteller: eintrag.hersteller,
      modell: eintrag.modell,
      seriennummer: "SN-" + Math.floor(100000 + Math.random() * 899999),
      standort_id: orte.bauhof,
      schlagworte: eintrag.worte.map((w) => worte[w]).filter(Boolean),
    },
  });
  if (a.status === 201) angelegt.push(a.json);
}

// ── Ein paar Buchungen, damit die Liste lebendig aussieht ───────────────────
const buche = (koerper) => anfrage("/api/buchungen", { methode: "POST", koerper });

if (angelegt[0]) {
  await buche({
    geraet_id: angelegt[0].id,
    art: "ausgabe",
    nach_standort_id: orte.lindengasse,
    empfaenger_id: ichId,
    geplante_rueckgabe: "2026-07-01", // absichtlich überfällig
    notiz: "Für die Hofeinfahrt",
  });
}
if (angelegt[2]) {
  await buche({
    geraet_id: angelegt[2].id,
    art: "ausgabe",
    nach_standort_id: orte.ahornweg,
    empfaenger_freitext: "Fa. Huber, Hr. Mayer",
  });
}
if (angelegt[3]) {
  await buche({ geraet_id: angelegt[3].id, art: "ausgabe", nach_standort_id: orte.lindengasse, empfaenger_id: ichId });
}
if (angelegt[5]) {
  // Ein defektes Gerät, damit die Sperre sichtbar wird.
  await buche({ geraet_id: angelegt[5].id, art: "ausgabe", nach_standort_id: orte.ahornweg, empfaenger_id: ichId });
  await buche({
    geraet_id: angelegt[5].id,
    art: "ruecknahme",
    nach_standort_id: orte.werkstatt,
    ausfall: true,
    notiz: "Trennscheibe verkantet, Spindel prüfen",
  });
}
// Zwei Geräte ins Regal einlagern
for (const [i, g] of [angelegt[1], angelegt[4]].entries()) {
  if (!g || !regale[i]) continue;
  await buche({ geraet_id: g.id, art: "ausgabe", nach_standort_id: orte.lindengasse, empfaenger_id: ichId });
  await buche({
    geraet_id: g.id,
    art: "ruecknahme",
    nach_standort_id: orte.bauhof,
    nach_lagerplatz_id: regale[i].id,
  });
}

const bestand = (await anfrage("/api/geraete")).json;
console.log(`\nBeispieldaten angelegt:`);
console.log(`  ${bestand.length} Geräte`);
console.log(`  ${Object.keys(orte).length} Orte, ${regale.length} Lagerplätze`);
console.log(`  ${Object.keys(worte).length} Schlagworte`);
console.log(`  Nummern: ${bestand.map((g) => g.inventarnummer).join(", ")}`);
console.log(`  Regale:  ${regale.map((r) => r.barcode).join(", ")}\n`);
