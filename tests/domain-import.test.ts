/**
 * Import-Prüfung. Reine Fachlogik, keine Datenbank.
 *
 * Schwerpunkt: die beiden Regeln, die Julius vorgegeben hat —
 * unvollständige Zeilen werden angelegt, und eine leere Zelle löscht nichts.
 * Die zweite ist die wichtigere: Wer in Excel versehentlich eine Spalte
 * markiert und löscht, dürfte damit nicht 200 Angaben vernichten.
 */

import { describe, expect, it } from "vitest";
import { pruefeZeilen, SPALTEN, type VorhandenesGeraet } from "../src/domain/import.js";

const BESTAND: VorhandenesGeraet[] = [
  {
    id: "aaaa1111-0000-0000-0000-000000000001",
    inventarnummer: "10001",
    bezeichnung: "Rüttelplatte 600 kg",
    hersteller: "Wacker Neuson",
    modell: "DPU 6555",
    seriennummer: "SN-4711",
    anschaffungsdatum: "2024-05-12",
    anschaffungswert: "5400.00",
    betriebsstunden: "128.5",
    notiz: null,
    rev: 3,
    schlagworte: [{ id: "w1", name: "Verdichtung" }],
  },
];

const zeile = (werte: Record<string, string>) => ({ ...werte });

describe("Unvollständige Zeilen werden angelegt", () => {
  it("nimmt eine Zeile mit nur einer Bezeichnung an", () => {
    const ergebnis = pruefeZeilen([zeile({ [SPALTEN.bezeichnung]: "Bohrhammer" })], [], []);
    expect(ergebnis.fehler).toBe(0);
    expect(ergebnis.neu).toBe(1);
    expect(ergebnis.schreibbar).toBe(true);
  });

  it("nimmt eine Datei an, die nur die Spalte Bezeichnung hat", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({ [SPALTEN.bezeichnung]: "Bohrhammer" }),
        zeile({ [SPALTEN.bezeichnung]: "Trennschleifer" }),
        zeile({ [SPALTEN.bezeichnung]: "Rüttelflasche" }),
      ],
      [],
      [],
    );
    expect(ergebnis.neu).toBe(3);
    expect(ergebnis.schreibbar).toBe(true);
  });

  it("stört sich nicht an leeren Zellen bei einem neuen Gerät", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.bezeichnung]: "Nivelliergerät",
          [SPALTEN.hersteller]: "",
          [SPALTEN.seriennummer]: "",
          [SPALTEN.anschaffungswert]: "",
          [SPALTEN.anschaffungsdatum]: "",
        }),
      ],
      [],
      [],
    );
    expect(ergebnis.fehler).toBe(0);
    expect(ergebnis.zeilen[0]!.werte.hersteller).toBeUndefined();
  });

  it("übergeht unbekannte Spalten, statt sie zu bemängeln", () => {
    // Julius soll in Excel eigene Notizspalten führen dürfen.
    const ergebnis = pruefeZeilen(
      [zeile({ [SPALTEN.bezeichnung]: "Bagger", "Eigene Notiz": "steht hinten", Preisklasse: "C" })],
      [],
      [],
    );
    expect(ergebnis.fehler).toBe(0);
    expect(ergebnis.neu).toBe(1);
  });

  it("meldet eine fehlende Bezeichnung als einzigen harten Fehler", () => {
    const ergebnis = pruefeZeilen(
      [zeile({ [SPALTEN.bezeichnung]: "", [SPALTEN.hersteller]: "Hilti" })],
      [],
      [],
    );
    expect(ergebnis.fehler).toBe(1);
    expect(ergebnis.zeilen[0]!.meldung).toMatch(/Bezeichnung/);
    expect(ergebnis.schreibbar).toBe(false);
  });
});

describe("Leere Zelle löscht keinen vorhandenen Wert", () => {
  it("lässt den Hersteller stehen, wenn die Zelle leer ist", () => {
    // DER Fall: In Excel wurde eine Spalte versehentlich geleert.
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.inventarnummer]: "10001",
          [SPALTEN.bezeichnung]: "Rüttelplatte 600 kg",
          [SPALTEN.hersteller]: "",
          [SPALTEN.rev]: "3",
        }),
      ],
      BESTAND,
      [],
    );
    expect(ergebnis.zeilen[0]!.art).toBe("unveraendert");
    expect(ergebnis.zeilen[0]!.aenderungen).toEqual([]);
    expect(ergebnis.zeilen[0]!.werte.hersteller).toBeUndefined();
  });

  it("meldet eine Datei mit lauter leeren Zellen als unverändert", () => {
    // Sonst stünden nach jedem Export-Import-Durchlauf 200 Zeilen als
    // "geändert" da, ohne dass sich etwas ändert.
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.inventarnummer]: "10001",
          [SPALTEN.bezeichnung]: "Rüttelplatte 600 kg",
          [SPALTEN.hersteller]: "",
          [SPALTEN.modell]: "",
          [SPALTEN.seriennummer]: "",
          [SPALTEN.notiz]: "",
          [SPALTEN.rev]: "3",
        }),
      ],
      BESTAND,
      [],
    );
    expect(ergebnis.unveraendert).toBe(1);
    expect(ergebnis.geaendert).toBe(0);
  });

  it("löscht einen Wert sehr wohl, wenn ein Bindestrich drinsteht", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.inventarnummer]: "10001",
          [SPALTEN.bezeichnung]: "Rüttelplatte 600 kg",
          [SPALTEN.hersteller]: "-",
          [SPALTEN.rev]: "3",
        }),
      ],
      BESTAND,
      [],
    );
    expect(ergebnis.geaendert).toBe(1);
    expect(ergebnis.zeilen[0]!.werte.hersteller).toBeNull();
    expect(ergebnis.zeilen[0]!.aenderungen[0]).toEqual({
      feld: "hersteller",
      alt: "Wacker Neuson",
      neu: "",
    });
  });
});

describe("Änderungen erkennen", () => {
  it("meldet nur die Felder, die sich wirklich ändern", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.inventarnummer]: "10001",
          [SPALTEN.bezeichnung]: "Rüttelplatte 600 kg",
          [SPALTEN.hersteller]: "Wacker Neuson",
          [SPALTEN.modell]: "DPU 6555-2",
          [SPALTEN.rev]: "3",
        }),
      ],
      BESTAND,
      [],
    );
    expect(ergebnis.geaendert).toBe(1);
    expect(ergebnis.zeilen[0]!.aenderungen).toHaveLength(1);
    expect(ergebnis.zeilen[0]!.aenderungen[0]!.feld).toBe("modell");
  });

  it("versteht deutsche Zahlen und Daten aus Excel", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.bezeichnung]: "Kernbohrgerät",
          [SPALTEN.anschaffungswert]: "1.234,50",
          [SPALTEN.anschaffungsdatum]: "31.03.2026",
        }),
      ],
      [],
      [],
    );
    expect(ergebnis.fehler).toBe(0);
    expect(ergebnis.zeilen[0]!.werte.anschaffungswert).toBe(1234.5);
    expect(ergebnis.zeilen[0]!.werte.anschaffungsdatum).toBe("2026-03-31");
  });

  it("meldet einen unbrauchbaren Wert mit Zeilennummer statt ihn zu verschlucken", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({ [SPALTEN.bezeichnung]: "Erstes" }),
        zeile({ [SPALTEN.bezeichnung]: "Zweites", [SPALTEN.anschaffungswert]: "ca. 3000" }),
      ],
      [],
      [],
    );
    expect(ergebnis.fehler).toBe(1);
    // Kopfzeile ist Zeile 1, also ist die zweite Datenzeile Zeile 3.
    expect(ergebnis.zeilen[1]!.nummer).toBe(3);
    expect(ergebnis.zeilen[1]!.meldung).toContain("ca. 3000");
    expect(ergebnis.schreibbar).toBe(false);
  });
});

describe("Änderungen zwischen Export und Import", () => {
  it("meldet einen Konflikt, wenn das Gerät inzwischen bearbeitet wurde", () => {
    // Die Datei stammt von Fassung 2, in der App steht inzwischen 3.
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.inventarnummer]: "10001",
          [SPALTEN.bezeichnung]: "Rüttelplatte klein",
          [SPALTEN.rev]: "2",
        }),
      ],
      BESTAND,
      [],
    );
    expect(ergebnis.konflikte).toBe(1);
    // Die Meldung nennt beide Fassungen und den aktuellen Stand, damit man
    // sieht, was einem entgehen würde.
    expect(ergebnis.zeilen[0]!.meldung).toContain("Rüttelplatte 600 kg");
    expect(ergebnis.zeilen[0]!.meldung).toContain("3");
    expect(ergebnis.schreibbar).toBe(false);
  });

  it("behandelt eine Datei ohne Fassungsspalte als gültig", () => {
    // Jemand hat die Datei selbst gebaut — dann gibt es nichts zu vergleichen.
    const ergebnis = pruefeZeilen(
      [zeile({ [SPALTEN.inventarnummer]: "10001", [SPALTEN.bezeichnung]: "Rüttelplatte neu" })],
      BESTAND,
      [],
    );
    expect(ergebnis.konflikte).toBe(0);
    expect(ergebnis.geaendert).toBe(1);
  });
});

describe("Doppelte Nummern in der Datei", () => {
  it("weist eine zweite Zeile mit derselben Nummer ab", () => {
    // Sonst überschriebe die zweite Zeile stillschweigend die erste.
    const ergebnis = pruefeZeilen(
      [
        zeile({ [SPALTEN.inventarnummer]: "20001", [SPALTEN.bezeichnung]: "Erstes" }),
        zeile({ [SPALTEN.inventarnummer]: "20001", [SPALTEN.bezeichnung]: "Zweites" }),
      ],
      [],
      [],
    );
    expect(ergebnis.fehler).toBe(1);
    expect(ergebnis.zeilen[1]!.meldung).toContain("mehrfach");
  });
});

describe("Standort und Zustand", () => {
  it("übernimmt sie nicht und sagt das ausdrücklich", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.inventarnummer]: "10001",
          [SPALTEN.bezeichnung]: "Rüttelplatte 600 kg",
          [SPALTEN.standort]: "Baustelle Lindengasse",
          [SPALTEN.status]: "ausgegeben",
          [SPALTEN.rev]: "3",
        }),
      ],
      BESTAND,
      [],
    );
    expect(ergebnis.zeilen[0]!.art).toBe("unveraendert");
    expect(ergebnis.hinweise.join(" ")).toMatch(/Standort und Zustand.*NICHT/);
  });
});

describe("Schlagworte", () => {
  it("erkennt neue Schlagworte und meldet sie vorab", () => {
    const ergebnis = pruefeZeilen(
      [zeile({ [SPALTEN.bezeichnung]: "Bagger", [SPALTEN.schlagworte]: "Erdbau, Mietgerät" })],
      [],
      ["Verdichtung"],
    );
    expect(ergebnis.neueSchlagworte).toEqual(["Erdbau", "Mietgerät"]);
    expect(ergebnis.hinweise.join(" ")).toContain("Erdbau");
  });

  it("meldet keine Änderung, wenn dieselben Schlagworte in anderer Reihenfolge stehen", () => {
    const ergebnis = pruefeZeilen(
      [
        zeile({
          [SPALTEN.inventarnummer]: "10001",
          [SPALTEN.bezeichnung]: "Rüttelplatte 600 kg",
          [SPALTEN.schlagworte]: "Verdichtung",
          [SPALTEN.rev]: "3",
        }),
      ],
      BESTAND,
      ["Verdichtung"],
    );
    expect(ergebnis.unveraendert).toBe(1);
  });
});

describe("Leere Datei", () => {
  it("ist nicht schreibbar", () => {
    const ergebnis = pruefeZeilen([], [], []);
    expect(ergebnis.schreibbar).toBe(false);
  });
});
