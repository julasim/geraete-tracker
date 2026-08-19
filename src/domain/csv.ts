/**
 * CSV lesen und schreiben — auf Excel abgestimmt.
 *
 * Reine Funktionen, ohne Datenbank und ohne HTTP.
 *
 * Der Aufwand hier steckt nicht im Zerlegen von Textzeilen, sondern in fünf
 * Eigenheiten, die alle gleichzeitig auftreten, sobald jemand in Österreich
 * eine Datei in Excel öffnet und wieder speichert:
 *
 *   1. Excel schreibt und erwartet SEMIKOLON, nicht Komma
 *   2. Ohne BOM hält Excel eine UTF-8-Datei für Windows-1252 —
 *      aus "Rüttelplatte" wird "RÃ¼ttelplatte"
 *   3. Excel macht aus 010013 die Zahl 10013
 *   4. Dezimalzahlen mit Komma: 1234,50
 *   5. Datum als 31.03.2026
 *
 * Deshalb: Der Export ist bewusst Excel-freundlich (Semikolon, BOM), der
 * Import bewusst tolerant (erkennt beides).
 *
 * Kein Fremdpaket: Für dieses feste Schema sind es rund 60 Zeilen, und eine
 * Bibliothek wäre mehr Abhängigkeit als Ersparnis.
 */

/** Der Wert, mit dem man einen vorhandenen Eintrag absichtlich leert. */
export const LEEREN = "-";

export interface CsvTabelle {
  spalten: string[];
  zeilen: Record<string, string>[];
  /** Erkanntes Trennzeichen — für die Rückmeldung an den Benutzer. */
  trennzeichen: string;
}

// ── Lesen ──────────────────────────────────────────────────────────────────

/**
 * Wandelt die hochgeladenen Bytes in Text.
 *
 * UTF-8 ist der Normalfall; ein BOM wird entfernt. Enthält das Ergebnis das
 * Ersetzungszeichen U+FFFD, war es kein gültiges UTF-8 — dann stammt die
 * Datei mit hoher Wahrscheinlichkeit aus Excel und ist Windows-1252.
 */
export function alsText(bytes: Uint8Array): string {
  const alsUtf8 = new TextDecoder("utf-8").decode(bytes);
  if (!alsUtf8.includes("�")) return ohneBom(alsUtf8);

  try {
    return ohneBom(new TextDecoder("windows-1252").decode(bytes));
  } catch {
    // Sollte die Laufzeitumgebung Windows-1252 nicht kennen, ist ein Text
    // mit ein paar kaputten Zeichen immer noch besser als gar keiner.
    return ohneBom(alsUtf8);
  }
}

const ohneBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Welches Trennzeichen die Datei verwendet.
 *
 * Nicht geraten, sondern gemessen: Die Kopfzeile wird mit jedem Kandidaten
 * zerlegt, und es gewinnt der mit den meisten Feldern. Ein Semikolon in
 * einem Freitext kann so nicht zur Fehlentscheidung führen, solange die
 * Kopfzeile eindeutig ist.
 */
export function erkenneTrennzeichen(text: string): string {
  const kopfzeile = text.split(/\r?\n/, 1)[0] ?? "";
  let bestes = ";";
  let meiste = 0;
  for (const kandidat of [";", ",", "\t", "|"]) {
    const anzahl = zerlegeZeile(kopfzeile, kandidat).length;
    if (anzahl > meiste) {
      meiste = anzahl;
      bestes = kandidat;
    }
  }
  return bestes;
}

/**
 * Zerlegt eine Zeile unter Beachtung von Anführungszeichen.
 * Ein doppeltes Anführungszeichen im Feld steht für ein einfaches.
 */
function zerlegeZeile(zeile: string, trenner: string): string[] {
  const felder: string[] = [];
  let feld = "";
  let inAnfuehrung = false;

  for (let i = 0; i < zeile.length; i++) {
    const zeichen = zeile[i]!;
    if (inAnfuehrung) {
      if (zeichen === '"') {
        if (zeile[i + 1] === '"') {
          feld += '"';
          i++;
        } else {
          inAnfuehrung = false;
        }
      } else {
        feld += zeichen;
      }
    } else if (zeichen === '"') {
      inAnfuehrung = true;
    } else if (zeichen === trenner) {
      felder.push(feld);
      feld = "";
    } else {
      feld += zeichen;
    }
  }
  felder.push(feld);
  return felder;
}

/**
 * Zerlegt den gesamten Text in Zeilen — Zeilenumbrüche INNERHALB von
 * Anführungszeichen gehören zum Feld und trennen nicht.
 */
function zerlegeZeilen(text: string): string[] {
  const zeilen: string[] = [];
  let aktuelle = "";
  let inAnfuehrung = false;

  for (let i = 0; i < text.length; i++) {
    const zeichen = text[i]!;
    if (zeichen === '"') {
      inAnfuehrung = !inAnfuehrung;
      aktuelle += zeichen;
    } else if ((zeichen === "\n" || zeichen === "\r") && !inAnfuehrung) {
      if (zeichen === "\r" && text[i + 1] === "\n") i++;
      zeilen.push(aktuelle);
      aktuelle = "";
    } else {
      aktuelle += zeichen;
    }
  }
  if (aktuelle.length) zeilen.push(aktuelle);
  return zeilen;
}

export function leseCsv(bytes: Uint8Array): CsvTabelle {
  const text = alsText(bytes);
  const trennzeichen = erkenneTrennzeichen(text);
  const zeilen = zerlegeZeilen(text).filter((z) => z.trim().length > 0);

  if (!zeilen.length) return { spalten: [], zeilen: [], trennzeichen };

  const spalten = zerlegeZeile(zeilen[0]!, trennzeichen).map((s) => s.trim());

  const daten = zeilen.slice(1).map((zeile) => {
    const felder = zerlegeZeile(zeile, trennzeichen);
    const satz: Record<string, string> = {};
    spalten.forEach((spalte, i) => {
      satz[spalte] = (felder[i] ?? "").trim();
    });
    return satz;
  });

  return { spalten, zeilen: daten, trennzeichen };
}

// ── Schreiben ──────────────────────────────────────────────────────────────

/**
 * Baut eine CSV-Datei, die Excel auf Anhieb richtig öffnet:
 * Semikolon als Trennzeichen, BOM voran, CRLF als Zeilenende.
 */
export function schreibeCsv(spalten: string[], zeilen: Record<string, unknown>[]): string {
  const kopf = spalten.map(feldAus).join(";");
  const inhalt = zeilen.map((zeile) => spalten.map((s) => feldAus(zeile[s])).join(";"));
  // Das BOM ist der Unterschied zwischen lesbaren Umlauten und "RÃ¼ttelplatte".
  return "﻿" + [kopf, ...inhalt].join("\r\n") + "\r\n";
}

function feldAus(wert: unknown): string {
  if (wert === null || wert === undefined) return "";
  const text = String(wert);
  // Anführungszeichen sind nur nötig, wenn das Feld ein Sonderzeichen enthält —
  // sonst bläht sich die Datei auf und wird von Hand schlechter lesbar.
  if (/[";\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

// ── Werte umwandeln ────────────────────────────────────────────────────────

/**
 * Zahl aus einem Feld. Nimmt "1234.50" und "1234,50", auch mit
 * Tausenderpunkten aus Excel ("1.234,50").
 *
 * Gibt `undefined` zurück, wenn das Feld leer ist, und wirft, wenn etwas
 * drinsteht, das keine Zahl ist — "ca. 3000" soll nicht still zu 3000 werden.
 */
export function zahlAus(feld: string): number | undefined {
  const roh = feld.trim();
  if (!roh) return undefined;

  let text = roh;
  // "1.234,50" → Punkt ist Tausendertrenner, Komma ist Dezimaltrenner
  if (text.includes(",") && text.includes(".")) text = text.replace(/\./g, "");
  text = text.replace(",", ".");

  const zahl = Number(text);
  if (!Number.isFinite(zahl)) throw new Error(`"${roh}" ist keine Zahl.`);
  return zahl;
}

/**
 * Datum aus einem Feld. Nimmt "2026-03-31" und "31.03.2026".
 * Gibt es immer als "JJJJ-MM-TT" zurück.
 */
export function datumAus(feld: string): string | undefined {
  const roh = feld.trim();
  if (!roh) return undefined;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(roh);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const deutsch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(roh);
  if (deutsch) {
    const tag = deutsch[1]!.padStart(2, "0");
    const monat = deutsch[2]!.padStart(2, "0");
    return `${deutsch[3]}-${monat}-${tag}`;
  }

  throw new Error(`"${roh}" ist kein Datum (erwartet: 31.03.2026 oder 2026-03-31).`);
}

/** Datum für den Export: "2026-03-31" → "31.03.2026". */
export function datumFuerExport(wert: string | Date | null | undefined): string {
  if (!wert) return "";
  const text = typeof wert === "string" ? wert : wert.toISOString();
  const teile = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return teile ? `${teile[3]}.${teile[2]}.${teile[1]}` : "";
}

/** Zahl für den Export — mit Komma, weil Excel sonst Text daraus macht. */
export function zahlFuerExport(wert: string | number | null | undefined): string {
  if (wert === null || wert === undefined || wert === "") return "";
  return String(wert).replace(".", ",");
}
