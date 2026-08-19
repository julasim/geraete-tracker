/**
 * Bestand aus- und einlesen.
 *
 * Zwei getrennte Endpunkte für den Import, und das ist Absicht: Der erste
 * schreibt garantiert nichts. Diese Zusicherung ist der Grund, warum man
 * dem zweiten überhaupt eine Datei anvertrauen kann.
 */

import { Hono, type Context } from "hono";
import { darf, angemeldet, type AppEnv } from "../auth.js";
import { EingabeFehler } from "../fehler.js";
import { leseCsv } from "../../domain/csv.js";
import { exportiere, pruefeImport, schreibeImport } from "../../data/austausch.js";
import { logInfo } from "../../logger.js";

export const austauschRouten = new Hono<AppEnv>();

/** Größengrenzen — gegen den versehentlich hochgeladenen Datenberg. */
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ZEILEN = 5_000;

austauschRouten.get("/export/geraete.csv", darf("daten.austauschen"), async (c) => {
  const csv = await exportiere();
  const datum = new Date().toISOString().slice(0, 10);

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="geraete-${datum}.csv"`);
  // Kein Zwischenspeichern: Der Bestand ändert sich ständig, und eine
  // veraltete Datei zu importieren wäre der Anfang von Ärger.
  c.header("Cache-Control", "no-store");
  return c.body(csv);
});

/** Liest die hochgeladene Datei und gibt die Zeilen zurück. */
async function zeilenAusAnfrage(c: Context<AppEnv>) {
  const formular = await c.req.formData().catch(() => null);
  if (!formular) throw new EingabeFehler("Die Anfrage enthält kein Formular.");

  const datei = formular.get("datei");
  if (!(datei instanceof File)) {
    throw new EingabeFehler('Es wurde keine Datei gesendet (Feld "datei").');
  }
  if (datei.size === 0) throw new EingabeFehler("Die Datei ist leer.");
  if (datei.size > MAX_BYTES) {
    throw new EingabeFehler(
      `Die Datei ist zu groß (${(datei.size / 1024 / 1024).toFixed(1)} MB). ` +
        `Erlaubt sind bis zu ${MAX_BYTES / 1024 / 1024} MB.`,
    );
  }

  const tabelle = leseCsv(new Uint8Array(await datei.arrayBuffer()));

  if (!tabelle.zeilen.length) {
    throw new EingabeFehler(
      "Die Datei enthält keine Datenzeilen. Erwartet wird eine Kopfzeile mit " +
        'mindestens der Spalte "Bezeichnung" und darunter je eine Zeile pro Gerät.',
    );
  }
  if (tabelle.zeilen.length > MAX_ZEILEN) {
    throw new EingabeFehler(
      `Die Datei hat ${tabelle.zeilen.length} Zeilen. Verarbeitet werden bis zu ${MAX_ZEILEN}.`,
    );
  }
  return tabelle;
}

/**
 * Vorschau. Schreibt garantiert nichts — nur lesen und einordnen.
 */
austauschRouten.post("/import/geraete/pruefen", darf("daten.austauschen"), async (c) => {
  const tabelle = await zeilenAusAnfrage(c);
  const ergebnis = await pruefeImport(tabelle.zeilen);

  return c.json({
    ...ergebnis,
    gelesen: tabelle.zeilen.length,
    spalten: tabelle.spalten,
    trennzeichen: tabelle.trennzeichen === "\t" ? "Tabulator" : tabelle.trennzeichen,
  });
});

/**
 * Schreiben. Die Datei wird ein zweites Mal geprüft — der Aufrufer könnte
 * eine andere schicken als die, die er hat prüfen lassen.
 */
austauschRouten.post("/import/geraete", darf("daten.austauschen"), async (c) => {
  const benutzer = angemeldet(c);
  const tabelle = await zeilenAusAnfrage(c);
  const ergebnis = await pruefeImport(tabelle.zeilen);

  if (!ergebnis.schreibbar) {
    const grund =
      ergebnis.fehler > 0
        ? `${ergebnis.fehler} Zeile(n) sind fehlerhaft`
        : ergebnis.konflikte > 0
          ? `${ergebnis.konflikte} Gerät(e) wurden zwischenzeitlich geändert`
          : "die Datei enthält keine verwertbaren Zeilen";
    return c.json(
      {
        error: `Der Import wurde nicht ausgeführt: ${grund}. Es wurde nichts geändert.`,
        pruefung: ergebnis,
      },
      409,
    );
  }

  const geschrieben = await schreibeImport(ergebnis, benutzer.id);
  logInfo("Import ausgeführt", { benutzer: benutzer.benutzername, ...geschrieben });

  return c.json(geschrieben);
});
