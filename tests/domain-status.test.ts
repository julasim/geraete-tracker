/**
 * Der Zustandsautomat. Reine Logik, keine Datenbank — deshalb hier
 * erschöpfend geprüft: JEDE Kombination aus Zustand und Buchungsart.
 *
 * Wenn dieser Teil stimmt, kann der Bestand nicht durch eine Lücke im
 * Regelwerk falsch werden, sondern höchstens durch einen Fehler im
 * Zusammenspiel mit der Datenbank — und den prüfen die anderen Dateien.
 */

import { describe, expect, it } from "vitest";
import {
  erlaubteAktionen,
  folgeStatus,
  hinweisZuStatus,
  pruefeUebergang,
  type Buchungsart,
  type Status,
} from "../src/domain/status.js";

const ALLE_ZUSTAENDE: Status[] = [
  "verfuegbar",
  "ausgegeben",
  "wartung",
  "defekt",
  "ausgemustert",
];
const ALLE_ARTEN: Buchungsart[] = ["ausgabe", "ruecknahme", "umbuchung", "korrektur"];

/** Was erlaubt sein MUSS — bewusst als eigene Tabelle, nicht aus dem Code. */
const SOLL: Record<Buchungsart, Status[]> = {
  ausgabe: ["verfuegbar"],
  ruecknahme: ["ausgegeben"],
  umbuchung: ["ausgegeben"],
  korrektur: ["verfuegbar", "ausgegeben", "wartung", "defekt"],
};

describe("Alle Übergänge, erschöpfend", () => {
  for (const art of ALLE_ARTEN) {
    for (const zustand of ALLE_ZUSTAENDE) {
      const sollGehen = SOLL[art].includes(zustand);
      it(`${art} aus "${zustand}" ${sollGehen ? "geht" : "geht NICHT"}`, () => {
        if (sollGehen) {
          expect(() => pruefeUebergang(zustand, art)).not.toThrow();
        } else {
          expect(() => pruefeUebergang(zustand, art)).toThrow();
        }
      });
    }
  }
});

describe("Die Fälle, die im Alltag wehtun", () => {
  it("verhindert das doppelte Ausgeben", () => {
    // Zwei Leute scannen dasselbe Gerät. Der zweite darf es nicht auch
    // noch ausgeben, sonst steht es an zwei Orten.
    expect(() => pruefeUebergang("ausgegeben", "ausgabe")).toThrow(/bereits ausgegeben/i);
  });

  it("verhindert das Ausgeben eines defekten Geräts", () => {
    expect(() => pruefeUebergang("defekt", "ausgabe")).toThrow(/defekt/i);
  });

  it("verhindert die Rücknahme von etwas, das gar nicht draußen ist", () => {
    expect(() => pruefeUebergang("verfuegbar", "ruecknahme")).toThrow(/nicht ausgegeben/i);
  });

  it("verhindert das Umbuchen eines Geräts, das im Lager steht", () => {
    expect(() => pruefeUebergang("verfuegbar", "umbuchung")).toThrow(/ausgegeben/i);
  });

  it("lässt ausgemusterte Geräte in Ruhe", () => {
    for (const art of ALLE_ARTEN) {
      expect(() => pruefeUebergang("ausgemustert", art)).toThrow();
    }
  });

  it("erklärt jeden Fehlschlag verständlich, nicht nur mit einem Code", () => {
    try {
      pruefeUebergang("defekt", "ausgabe");
      throw new Error("hätte werfen müssen");
    } catch (e) {
      const text = (e as Error).message;
      expect(text.length).toBeGreaterThan(30);
      expect(text).toMatch(/Reparatur|defekt/i);
    }
  });
});

describe("Folgezustand", () => {
  it("macht aus einer Ausgabe ein ausgegebenes Gerät", () => {
    expect(folgeStatus("verfuegbar", "ausgabe")).toBe("ausgegeben");
  });

  it("macht aus einer Rücknahme ein verfügbares Gerät", () => {
    expect(folgeStatus("ausgegeben", "ruecknahme")).toBe("verfuegbar");
  });

  it("sperrt das Gerät bei einem Ausfallschaden sofort", () => {
    // Sonst gäbe es jemand am nächsten Morgen wieder aus.
    expect(folgeStatus("ausgegeben", "ruecknahme", true)).toBe("defekt");
  });

  it("lässt ein umgebuchtes Gerät ausgegeben", () => {
    expect(folgeStatus("ausgegeben", "umbuchung")).toBe("ausgegeben");
  });

  it("ändert bei einer Korrektur den Zustand nicht von selbst", () => {
    // Was die Korrektur setzt, gibt der Admin ausdrücklich an.
    for (const z of ALLE_ZUSTAENDE) {
      expect(folgeStatus(z, "korrektur")).toBe(z);
    }
  });
});

describe("Angebotene Aktionen", () => {
  it("bietet bei einem verfügbaren Gerät das Ausgeben an", () => {
    const arten = erlaubteAktionen("verfuegbar", false).map((a) => a.art);
    expect(arten).toContain("ausgabe");
    expect(arten).not.toContain("ruecknahme");
  });

  it("bietet bei einem ausgegebenen Gerät Rücknahme und Umbuchung an", () => {
    const arten = erlaubteAktionen("ausgegeben", false).map((a) => a.art);
    expect(arten).toEqual(expect.arrayContaining(["ruecknahme", "umbuchung"]));
    expect(arten).not.toContain("ausgabe");
  });

  it("bietet bei einem defekten Gerät keine Buchung an", () => {
    expect(erlaubteAktionen("defekt", false)).toHaveLength(0);
  });

  it("bietet bei einem ausgemusterten Gerät gar nichts an, auch dem Admin nicht", () => {
    expect(erlaubteAktionen("ausgemustert", true)).toHaveLength(0);
  });

  it("bietet nur dem Admin das Berichtigen an", () => {
    expect(erlaubteAktionen("verfuegbar", true).map((a) => a.art)).toContain("korrektur");
    expect(erlaubteAktionen("verfuegbar", false).map((a) => a.art)).not.toContain("korrektur");
  });

  it("kennzeichnet genau eine Hauptaktion, damit die Oberfläche sie hervorheben kann", () => {
    for (const zustand of ["verfuegbar", "ausgegeben"] as Status[]) {
      const haupt = erlaubteAktionen(zustand, true).filter((a) => a.hauptaktion);
      expect(haupt).toHaveLength(1);
    }
  });

  it("bietet nie eine Aktion an, die der Automat verbietet", () => {
    // Der eigentliche Punkt: Was die Oberfläche zeigt, muss auch durchgehen.
    for (const zustand of ALLE_ZUSTAENDE) {
      for (const aktion of erlaubteAktionen(zustand, true)) {
        expect(() => pruefeUebergang(zustand, aktion.art)).not.toThrow();
      }
    }
  });
});

describe("Hinweis zum Zustand", () => {
  it("erklärt gesperrte Zustände", () => {
    expect(hinweisZuStatus("defekt")).toMatch(/Schaden/i);
    expect(hinweisZuStatus("wartung")).toMatch(/Wartung/i);
    expect(hinweisZuStatus("ausgemustert")).toMatch(/ausgemustert/i);
  });

  it("schweigt, wenn alles in Ordnung ist", () => {
    expect(hinweisZuStatus("verfuegbar")).toBeNull();
    expect(hinweisZuStatus("ausgegeben")).toBeNull();
  });
});
