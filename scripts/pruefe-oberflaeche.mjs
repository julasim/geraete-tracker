#!/usr/bin/env node
/**
 * Prüft die Oberfläche gegen Server und Stylesheets.
 *
 * Zwei Fehlerarten, die in diesem Projekt beide schon passiert sind und die
 * weder TypeScript noch ESLint finden können:
 *
 * 1. **Eine Route ohne Bedienung.** `POST /standorte` gab es seit AP4, mit
 *    Rechteprüfung und Tests — nur rief es keine Ansicht auf. Baustellen
 *    ließen sich also nicht anlegen, und es fiel erst auf, als jemand es
 *    tun wollte. Dasselbe bei der Fristenliste (AP15).
 *
 * 2. **Eine Klasse, die es nicht gibt.** `class="pt-knopf"` statt `pt-btn`
 *    ist für den Übersetzer eine gültige Zeichenkette; die Ansicht wird
 *    stumm ungestaltet ausgeliefert. In PATIO liefen dadurch zehn Ansichten
 *    seit ihrem Bau ohne Gestaltung.
 *
 * Aufruf:
 *   node scripts/pruefe-oberflaeche.mjs
 *
 * Rückgabe 1, sobald etwas fehlt — damit die Prüfkette darüber stolpert.
 *
 * ── Zur Verlässlichkeit ───────────────────────────────────────────────────
 * Beim Bauen dieses Skripts haben zwei frühere Fassungen falsch gemeldet:
 * Die erste zählte Tests und Durchlauf-Skripte als „Bedienung" mit (die
 * legen Standorte an, also galt die Route als benutzt), die zweite übersah
 * die neun direkten `fetch()`-Aufrufe der Oberfläche. Beide Lehren stecken
 * hier drin: Gesucht wird ausschließlich in `web/src`, und beide Aufrufwege
 * werden erfasst.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const WURZEL = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function dateien(ordner, endungen) {
  const gefunden = [];
  for (const eintrag of readdirSync(ordner)) {
    const pfad = join(ordner, eintrag);
    if (statSync(pfad).isDirectory()) gefunden.push(...dateien(pfad, endungen));
    else if (endungen.includes(extname(pfad))) gefunden.push(pfad);
  }
  return gefunden;
}

const lies = (p) => readFileSync(join(WURZEL, p), "utf8");

// ── 1. Routen des Servers ──────────────────────────────────────────────────

const server = lies("src/api/server.ts");

/** Welcher Router hängt unter welchem Präfix? */
const praefixVon = new Map();
for (const m of server.matchAll(/app\.route\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g)) {
  praefixVon.set(m[2], m[1]);
}
/** Und aus welcher Datei stammt er? */
const dateiVon = new Map();
for (const m of server.matchAll(/import\s+\{?\s*(\w+)\s*\}?\s+from\s+"\.\/routes\/([\w-]+)\.js"/g)) {
  dateiVon.set(m[1], m[2]);
}

const routen = [];
for (const [bezeichner, praefix] of praefixVon) {
  const datei = dateiVon.get(bezeichner);
  if (!datei) continue;
  const quelle = lies(`src/api/routes/${datei}.ts`);
  for (const m of quelle.matchAll(/\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g)) {
    const pfad = (praefix.replace(/\/$/, "") + m[2]).replace(/\/\//g, "/") || praefix;
    routen.push({ verb: m[1].toUpperCase(), pfad, datei });
  }
}

// ── 2. Was die Oberfläche aufruft ──────────────────────────────────────────
//
// AUSSCHLIESSLICH web/src. Tests und Durchlauf-Skripte rufen die API
// ebenfalls auf — sie sind aber keine Bedienung, und genau diese Verwechslung
// hat die Lücke bei den Standorten verdeckt.

const oberflaeche = dateien(join(WURZEL, "web/src"), [".ts", ".vue"]).map((p) => ({
  name: p.split(/[\\/]/).pop(),
  text: readFileSync(p, "utf8"),
}));

const aufrufe = [];
for (const { name, text } of oberflaeche) {
  // a) über den API-Helfer: api.post("/standorte", …)
  for (const m of text.matchAll(/\bapi\.(get|post|patch|put|del|delete)(?:<[^>]*>)?\(\s*[`"']([^`"'$]*)/g)) {
    const verb = m[1].toUpperCase() === "DEL" ? "DELETE" : m[1].toUpperCase();
    aufrufe.push({ verb, pfad: "/api" + m[2], name });
  }
  // b) direkt: fetch("/api/etiketten/vorrat", { method: "POST" })
  //    Die Methode steht dabei erst im Objekt danach, deshalb wird ein
  //    Stück des folgenden Textes mitgelesen.
  for (const m of text.matchAll(/\bfetch\(\s*[`"']([^`"'$]*)[\s\S]{0,220}?/g)) {
    const nachher = text.slice(m.index, m.index + 260);
    const methode = /method:\s*["'](\w+)["']/.exec(nachher);
    aufrufe.push({ verb: (methode?.[1] ?? "GET").toUpperCase(), pfad: m[1], name });
  }
}

/** Trifft ein Aufruf diese Route? Aufrufpfade brechen an `${…}` ab. */
function wirdBedient(route) {
  const stamm = route.pfad.split(":")[0].replace(/\/$/, "");
  return aufrufe.some(
    (a) => a.verb === route.verb && (a.pfad === stamm || a.pfad.startsWith(stamm)),
  );
}

/**
 * Routen, die bewusst keine Bedienung haben — mit Begründung.
 * Jeder Eintrag hier ist eine Entscheidung, kein Versehen.
 */
const OHNE_BEDIENUNG = new Map([
  [
    "POST /api/buchungen/korrektur",
    "Gegenbuchung: bewusst nur über die Schnittstelle, damit niemand die Historie im Vorbeigehen begradigt",
  ],
  [
    "POST /api/etiketten/altbestand",
    "Einmalige Erfassung geklebter Altetiketten beim Einrichten, kein wiederkehrender Vorgang",
  ],
  [
    "POST /api/import/geraete/pruefen",
    "Bedienung in AustauschView.vue über Variable (istZip → endpunkt), vom Regex nicht auflösbar",
  ],
  [
    "POST /api/import/geraete",
    "Bedienung in AustauschView.vue über Variable (istZip → endpunkt), vom Regex nicht auflösbar",
  ],
  [
    "POST /api/import/paket/pruefen",
    "Bedienung in AustauschView.vue über Variable (istZip → endpunkt), vom Regex nicht auflösbar",
  ],
  [
    "POST /api/import/paket",
    "Bedienung in AustauschView.vue über Variable (istZip → endpunkt), vom Regex nicht auflösbar",
  ],
]);

const ohneBedienung = routen
  .filter((r) => r.verb !== "GET" && !wirdBedient(r))
  .filter((r) => !OHNE_BEDIENUNG.has(`${r.verb} ${r.pfad}`));

// ── 3. Klassen und Gestaltungsvariablen ────────────────────────────────────

const stile = lies("web/src/styles/basis.css") + lies("web/src/styles/tokens.css");
const klassenFehler = [];
const variablenFehler = [];

for (const { name, text } of oberflaeche) {
  if (!name.endsWith(".vue")) continue;
  const eigenerStil = text.split("<style").slice(1).join("<style");

  const eigene = new Set();
  for (const m of eigenerStil.matchAll(/\.([a-z][a-z0-9_-]*)/gi)) eigene.add(m[1]);

  for (const m of text.matchAll(/\sclass="([^"]*)"/g)) {
    for (const klasse of m[1].split(/\s+/)) {
      // Vue-Ausdrücke (:class) und Bedingungen überspringen
      if (!klasse || klasse.includes("{") || klasse.includes(":") || klasse.includes("$")) continue;
      if (eigene.has(klasse)) continue;
      // Ein BEM-Block darf ohne eigene Regel bleiben, solange es Kind-Regeln
      // gibt (.konflikt neben .konflikt__stand). Das ist Absicht, kein
      // Tippfehler — sonst meldete dieses Skript Fehlalarme, und ein
      // Prüfwerkzeug, dem man nicht glaubt, wird abgeschaltet.
      if ([...eigene].some((e) => e.startsWith(klasse + "__"))) continue;
      if (new RegExp(`\\.${klasse.replace(/[-]/g, "\\-")}\\b`).test(stile)) continue;
      klassenFehler.push({ name, klasse });
    }
  }

  for (const m of eigenerStil.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
    if (!stile.includes(m[1])) variablenFehler.push({ name, variable: m[1] });
  }
}

// ── Bericht ────────────────────────────────────────────────────────────────

console.log("\nOberflächen-Prüfung\n");

let fehler = 0;

if (ohneBedienung.length) {
  fehler += ohneBedienung.length;
  console.log("  Schreibende Routen OHNE Bedienung in der Oberfläche:");
  for (const r of ohneBedienung) console.log(`    FEHLT  ${r.verb.padEnd(6)} ${r.pfad}  (routes/${r.datei}.ts)`);
  console.log("    Entweder eine Ansicht dafür bauen — oder in OHNE_BEDIENUNG");
  console.log("    dieses Skripts mit Begründung eintragen.\n");
} else {
  console.log(`  OK   Jede schreibende Route ist bedienbar (${routen.filter((r) => r.verb !== "GET").length} geprüft,`);
  console.log(`       ${OHNE_BEDIENUNG.size} bewusst ausgenommen)`);
}

if (klassenFehler.length) {
  fehler += klassenFehler.length;
  console.log("\n  Klassen, die in keinem Stylesheet stehen:");
  for (const k of klassenFehler) console.log(`    FEHLT  ${k.klasse}  (${k.name})`);
} else {
  console.log("  OK   Jede benutzte CSS-Klasse existiert");
}

if (variablenFehler.length) {
  fehler += variablenFehler.length;
  console.log("\n  Gestaltungsvariablen, die es nicht gibt:");
  for (const v of variablenFehler) console.log(`    FEHLT  ${v.variable}  (${v.name})`);
} else {
  console.log("  OK   Jede benutzte CSS-Variable existiert");
}

console.log(
  fehler ? `\n${fehler} Befund(e).\n` : "\nDie Oberfläche ist vollständig verdrahtet.\n",
);
process.exit(fehler ? 1 : 0);
