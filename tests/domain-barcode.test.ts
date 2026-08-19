/**
 * Barcode-Normalisierung. Reine Fachlogik, braucht keine Datenbank —
 * und ist trotzdem einer der heikelsten Teile: Wer hier einen Code dem
 * falschen Gerät zuordnet, bucht still das falsche Gerät auf die Baustelle.
 */

import { describe, expect, it } from "vitest";
import {
  codeArt,
  naechsteNummer,
  naechsterPlatzCode,
  normalisiere,
  suchVarianten,
} from "../src/domain/barcode.js";

describe("Vereinheitlichen", () => {
  it("lässt eine saubere Nummer unverändert", () => {
    expect(normalisiere("10013")).toBe("10013");
  });

  it("entfernt Leerzeichen rundherum", () => {
    expect(normalisiere("  10013  ")).toBe("10013");
  });

  it("entfernt die Abschlusszeichen von Hardware-Scannern", () => {
    // Viele Bluetooth-Scanner hängen CR, LF oder Tab an.
    expect(normalisiere("10013\r\n")).toBe("10013");
    expect(normalisiere("10013\t")).toBe("10013");
  });

  it("behält den Bindestrich im Lagerplatz-Code", () => {
    // Ohne ihn wäre der Nummernkreis nicht mehr unterscheidbar.
    expect(normalisiere("P-0001")).toBe("P-0001");
  });

  it("ergänzt den fehlenden Bindestrich bei getippten Platz-Codes", () => {
    expect(normalisiere("P0001")).toBe("P-0001");
    expect(normalisiere("p0001")).toBe("P-0001");
  });

  it("macht Buchstaben groß", () => {
    expect(normalisiere("p-0001")).toBe("P-0001");
  });

  it("behält führende Nullen", () => {
    // Sonst wären "0042" und "42" nicht mehr unterscheidbar.
    expect(normalisiere("010013")).toBe("010013");
  });
});

describe("Einordnen", () => {
  it("erkennt eine Gerätenummer", () => {
    expect(codeArt("10013")).toBe("geraet");
    expect(codeArt(" 10001 ")).toBe("geraet");
  });

  it("erkennt einen Lagerplatz", () => {
    expect(codeArt("P-0001")).toBe("lagerplatz");
    expect(codeArt("p0042")).toBe("lagerplatz");
  });

  it("weist Unbrauchbares ab", () => {
    expect(codeArt("")).toBe("unbrauchbar");
    expect(codeArt("   ")).toBe("unbrauchbar");
    expect(codeArt("P-")).toBe("unbrauchbar");
    expect(codeArt("ABC123")).toBe("unbrauchbar");
    expect(codeArt("10013;DROP TABLE")).toBe("unbrauchbar");
  });

  it("hält Gerät und Lagerplatz strikt auseinander", () => {
    // Das ist der Kern des getrennten Nummernkreises: ein Code kann nie
    // beides sein, also ist ein Scan nie mehrdeutig.
    expect(codeArt("10013")).not.toBe(codeArt("P-10013"));
  });
});

describe("Suchvarianten", () => {
  it("sucht zuerst genau das, was gescannt wurde", () => {
    expect(suchVarianten("10013")[0]).toBe("10013");
  });

  it("bietet zusätzlich die Fassung ohne führende Nullen an", () => {
    const varianten = suchVarianten("010013");
    expect(varianten).toContain("010013");
    expect(varianten).toContain("10013");
    expect(varianten[0]).toBe("010013"); // die gescannte zuerst
  });

  it("bietet bei getippten Nummern auch die Fassung MIT führender Null an", () => {
    // Umgekehrter Fall: getippt "1234", das Etikett trägt "01234".
    expect(suchVarianten("1234")).toContain("01234");
  });

  it("liefert für leere Eingaben nichts", () => {
    expect(suchVarianten("")).toEqual([]);
    expect(suchVarianten("   ")).toEqual([]);
  });

  it("erfindet keine Varianten für Lagerplätze", () => {
    expect(suchVarianten("P-0001")).toEqual(["P-0001"]);
  });
});

describe("Nächste Nummer", () => {
  it("beginnt bei 10001, wenn noch nichts da ist", () => {
    expect(naechsteNummer(null)).toBe("10001");
  });

  it("zählt weiter", () => {
    expect(naechsteNummer("10013")).toBe("10014");
    expect(naechsteNummer("10099")).toBe("10100");
  });

  it("füllt kurze Nummern auf fünf Stellen auf", () => {
    expect(naechsteNummer("42")).toBe("00043");
  });

  it("zählt Lagerplätze getrennt", () => {
    expect(naechsterPlatzCode(null)).toBe("P-0001");
    expect(naechsterPlatzCode("P-0001")).toBe("P-0002");
    expect(naechsterPlatzCode("P-0099")).toBe("P-0100");
  });
});
