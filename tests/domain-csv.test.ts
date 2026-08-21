/**
 * CSV lesen und schreiben.
 *
 * Der Schwerpunkt liegt nicht auf dem Zerlegen von Textzeilen, sondern auf
 * den Eigenheiten von Excel im deutschen Sprachraum — dort scheitern solche
 * Ausfuhren in der Praxis.
 */

import { describe, expect, it } from "vitest";
import {
  alsText,
  datumAus,
  datumFuerExport,
  erkenneTrennzeichen,
  leseCsv,
  schreibeCsv,
  zahlAus,
  zahlFuerExport,
} from "../src/domain/csv.js";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("Zeichensatz", () => {
  it("liest UTF-8", () => {
    expect(alsText(bytes("Rüttelplatte"))).toBe("Rüttelplatte");
  });

  it("entfernt ein BOM am Anfang", () => {
    // Excel schreibt es, und ohne Entfernen hieße die erste Spalte
    // "<BOM>Inventarnummer" — der Import fände sie nicht.
    expect(alsText(bytes("\uFEFFInventarnummer"))).toBe("Inventarnummer");
  });

  it("erkennt eine Datei aus Excel (Windows-1252) an den Umlauten", () => {
    // "Rüttelplatte" in Windows-1252: ü ist ein einzelnes Byte 0xFC.
    const windows1252 = new Uint8Array([0x52, 0xfc, 0x74, 0x74, 0x65, 0x6c]);
    expect(alsText(windows1252)).toBe("Rüttel");
  });
});

describe("Trennzeichen", () => {
  it("erkennt Semikolon — was Excel im deutschen Gebietsschema schreibt", () => {
    expect(erkenneTrennzeichen("Nummer;Bezeichnung;Hersteller")).toBe(";");
  });

  it("erkennt Komma", () => {
    expect(erkenneTrennzeichen("Nummer,Bezeichnung,Hersteller")).toBe(",");
  });

  it("erkennt Tabulator", () => {
    expect(erkenneTrennzeichen("Nummer\tBezeichnung\tHersteller")).toBe("\t");
  });

  it("entscheidet sich für das Zeichen mit den meisten Feldern", () => {
    // Ein Komma im Freitext darf die Entscheidung nicht kippen.
    expect(erkenneTrennzeichen("Nummer;Bezeichnung, groß;Hersteller;Modell")).toBe(";");
  });
});

describe("Lesen", () => {
  it("liest eine gewöhnliche Datei", () => {
    const tabelle = leseCsv(bytes("Nummer;Bezeichnung\r\n10001;Rüttelplatte\r\n10002;Bagger\r\n"));
    expect(tabelle.spalten).toEqual(["Nummer", "Bezeichnung"]);
    expect(tabelle.zeilen).toHaveLength(2);
    expect(tabelle.zeilen[0]).toEqual({ Nummer: "10001", Bezeichnung: "Rüttelplatte" });
  });

  it("übergeht leere Zeilen", () => {
    const tabelle = leseCsv(bytes("A;B\r\n1;2\r\n\r\n3;4\r\n\r\n"));
    expect(tabelle.zeilen).toHaveLength(2);
  });

  it("versteht Anführungszeichen um ein Feld", () => {
    const tabelle = leseCsv(bytes('A;B\r\n"Wert; mit Semikolon";zwei\r\n'));
    expect(tabelle.zeilen[0]!.A).toBe("Wert; mit Semikolon");
  });

  it("versteht ein verdoppeltes Anführungszeichen im Feld", () => {
    const tabelle = leseCsv(bytes('A;B\r\n"Er sagte ""hallo""";zwei\r\n'));
    expect(tabelle.zeilen[0]!.A).toBe('Er sagte "hallo"');
  });

  it("versteht einen Zeilenumbruch innerhalb eines Feldes", () => {
    const tabelle = leseCsv(bytes('A;B\r\n"Zeile 1\r\nZeile 2";zwei\r\n'));
    expect(tabelle.zeilen).toHaveLength(1);
    expect(tabelle.zeilen[0]!.A).toContain("Zeile 1");
    expect(tabelle.zeilen[0]!.A).toContain("Zeile 2");
  });

  it("füllt fehlende Felder am Zeilenende mit Leerstring", () => {
    const tabelle = leseCsv(bytes("A;B;C\r\n1;2\r\n"));
    expect(tabelle.zeilen[0]).toEqual({ A: "1", B: "2", C: "" });
  });

  it("kommt mit einer leeren Datei zurecht", () => {
    expect(leseCsv(bytes("")).zeilen).toEqual([]);
  });
});

describe("Schreiben", () => {
  it("schreibt mit Semikolon und BOM, damit Excel es richtig öffnet", () => {
    const csv = schreibeCsv(["Nummer", "Bezeichnung"], [{ Nummer: "10001", Bezeichnung: "Bagger" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("Nummer;Bezeichnung");
    expect(csv).toContain("10001;Bagger");
  });

  it("verwendet CRLF als Zeilenende", () => {
    const csv = schreibeCsv(["A"], [{ A: "1" }]);
    expect(csv).toContain("\r\n");
  });

  it("setzt nur dann Anführungszeichen, wenn es nötig ist", () => {
    const csv = schreibeCsv(["A", "B"], [{ A: "harmlos", B: "mit;Semikolon" }]);
    expect(csv).toContain("harmlos");
    expect(csv).toContain('"mit;Semikolon"');
  });

  it("verdoppelt Anführungszeichen im Feld", () => {
    const csv = schreibeCsv(["A"], [{ A: 'sagte "hallo"' }]);
    expect(csv).toContain('"sagte ""hallo"""');
  });

  it("macht aus null und undefined ein leeres Feld", () => {
    const csv = schreibeCsv(["A", "B"], [{ A: null, B: undefined }]);
    expect(csv.split("\r\n")[1]).toBe(";");
  });

  it("schreibt, was sich wieder einlesen lässt", () => {
    const original = [
      { Bezeichnung: "Rüttelplatte 600 kg", Notiz: 'mit "Anführung"; und Semikolon' },
      { Bezeichnung: "Bagger", Notiz: "" },
    ];
    const csv = schreibeCsv(["Bezeichnung", "Notiz"], original);
    const gelesen = leseCsv(bytes(csv));
    expect(gelesen.zeilen).toEqual(original);
  });
});

describe("Zahlen", () => {
  it("nimmt Punkt als Dezimaltrenner", () => {
    expect(zahlAus("1234.50")).toBe(1234.5);
  });

  it("nimmt Komma als Dezimaltrenner — so schreibt es Excel", () => {
    expect(zahlAus("1234,50")).toBe(1234.5);
  });

  it("versteht Tausenderpunkte", () => {
    expect(zahlAus("1.234,50")).toBe(1234.5);
  });

  it("gibt bei einem leeren Feld nichts zurück", () => {
    expect(zahlAus("")).toBeUndefined();
    expect(zahlAus("   ")).toBeUndefined();
  });

  it("wirft bei etwas, das keine Zahl ist", () => {
    // "ca. 3000" soll nicht still zu 3000 werden.
    expect(() => zahlAus("ca. 3000")).toThrow();
    expect(() => zahlAus("k. A.")).toThrow();
  });

  it("schreibt mit Komma, weil Excel sonst Text daraus macht", () => {
    expect(zahlFuerExport("5400.00")).toBe("5400,00");
    expect(zahlFuerExport(null)).toBe("");
  });
});

describe("Datum", () => {
  it("nimmt die deutsche Schreibweise", () => {
    expect(datumAus("31.03.2026")).toBe("2026-03-31");
    expect(datumAus("1.4.2026")).toBe("2026-04-01");
  });

  it("nimmt die ISO-Schreibweise", () => {
    expect(datumAus("2026-03-31")).toBe("2026-03-31");
  });

  it("gibt bei einem leeren Feld nichts zurück", () => {
    expect(datumAus("")).toBeUndefined();
  });

  it("wirft bei etwas, das kein Datum ist", () => {
    expect(() => datumAus("Frühjahr 2026")).toThrow();
  });

  it("schreibt in der deutschen Schreibweise", () => {
    expect(datumFuerExport("2026-03-31")).toBe("31.03.2026");
    expect(datumFuerExport(null)).toBe("");
  });

  it("verliert beim Hin und Her keinen Tag", () => {
    // Der Zeitzonenfehler, der bei den Prüffristen aufgetreten ist,
    // darf hier nicht wieder entstehen.
    for (const d of ["2026-01-01", "2026-03-31", "2026-10-25", "2028-02-29", "2026-12-31"]) {
      expect(datumAus(datumFuerExport(d))).toBe(d);
    }
  });
});
