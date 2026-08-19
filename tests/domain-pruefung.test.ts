/**
 * Fälligkeitsrechnung.
 *
 * Dieser Test entstand nach einem Fehler, der beinahe durchgegangen wäre:
 * Aus "31.03.2026 plus 12 Monate" wurde der 30.03.2027 — ein Tag zu früh.
 * Ursache war eine Mischung aus lokal gebauten Daten und einer Ausgabe in
 * UTC. In Mitteleuropa liegt lokale Mitternacht ein bis zwei Stunden vor
 * UTC-Mitternacht, das Datum fällt dabei zurück.
 *
 * Bei einer sicherheitsrelevanten Prüffrist ist das kein Schönheitsfehler.
 */

import { describe, expect, it } from "vitest";
import {
  alsIsoDatum,
  ampel,
  ausIsoDatum,
  naechsteFaelligkeit,
  tageBis,
} from "../src/domain/pruefung.js";

/** Kurzschreibweise: Datum rein, Datum raus, beides als Text. */
const plus = (datum: string, monate: number) =>
  alsIsoDatum(naechsteFaelligkeit(ausIsoDatum(datum), monate));

describe("Fälligkeit", () => {
  it("rechnet ganze Jahre korrekt", () => {
    expect(plus("2026-01-15", 12)).toBe("2027-01-15");
  });

  it("verliert am Monatsletzten keinen Tag", () => {
    // Genau der Fehler, der hier aufgetreten ist.
    expect(plus("2026-03-31", 12)).toBe("2027-03-31");
    expect(plus("2026-10-31", 12)).toBe("2027-10-31");
  });

  it("rechnet über die Sommerzeitumstellung hinweg richtig", () => {
    // Ende März und Ende Oktober wird in Österreich umgestellt — genau dort
    // schlug die alte Rechnung zu.
    expect(plus("2026-03-28", 1)).toBe("2026-04-28");
    expect(plus("2026-10-24", 1)).toBe("2026-11-24");
    expect(plus("2026-03-29", 6)).toBe("2026-09-29");
  });

  it("zieht auf den letzten Tag zurück, wenn es den Stichtag nicht gibt", () => {
    // 31. August plus 6 Monate wäre der 31. Februar.
    expect(plus("2025-08-31", 6)).toBe("2026-02-28");
    // 2028 ist ein Schaltjahr.
    expect(plus("2027-08-31", 6)).toBe("2028-02-29");
  });

  it("kommt mit dem 29. Februar zurecht", () => {
    expect(plus("2028-02-29", 12)).toBe("2029-02-28");
    expect(plus("2028-02-29", 48)).toBe("2032-02-29");
  });

  it("rechnet über Jahresgrenzen", () => {
    expect(plus("2026-11-15", 3)).toBe("2027-02-15");
    expect(plus("2026-12-31", 1)).toBe("2027-01-31");
  });

  it("verträgt lange Intervalle", () => {
    expect(plus("2026-06-15", 120)).toBe("2036-06-15");
  });
});

describe("Tage bis zur Fälligkeit", () => {
  const heute = new Date(2026, 5, 15); // 15. Juni 2026, lokal

  it("zählt vorwärts", () => {
    expect(tageBis(ausIsoDatum("2026-06-25"), heute)).toBe(10);
  });

  it("zählt rückwärts bei Überfälligem", () => {
    expect(tageBis(ausIsoDatum("2026-06-05"), heute)).toBe(-10);
  });

  it("meldet am Fälligkeitstag selbst null", () => {
    expect(tageBis(ausIsoDatum("2026-06-15"), heute)).toBe(0);
  });

  it("hängt nicht an der Uhrzeit", () => {
    // Sonst wäre dieselbe Prüfung morgens "fällig" und abends "überfällig".
    const frueh = new Date(2026, 5, 15, 6, 0);
    const spaet = new Date(2026, 5, 15, 23, 30);
    const ziel = ausIsoDatum("2026-06-20");
    expect(tageBis(ziel, frueh)).toBe(tageBis(ziel, spaet));
  });
});

describe("Ampel", () => {
  const heute = new Date(2026, 5, 15);

  it("meldet Überfälliges", () => {
    expect(ampel(ausIsoDatum("2026-06-14"), heute)).toBe("ueberfaellig");
  });

  it("meldet Fälliges innerhalb von zwei Wochen", () => {
    expect(ampel(ausIsoDatum("2026-06-20"), heute)).toBe("faellig");
    expect(ampel(ausIsoDatum("2026-06-29"), heute)).toBe("faellig");
  });

  it("meldet bald Fälliges", () => {
    expect(ampel(ausIsoDatum("2026-07-20"), heute)).toBe("bald");
  });

  it("schweigt bei allem, was weit weg ist", () => {
    expect(ampel(ausIsoDatum("2027-01-01"), heute)).toBe("ok");
  });

  it("zählt den Fälligkeitstag selbst noch nicht als überfällig", () => {
    expect(ampel(ausIsoDatum("2026-06-15"), heute)).toBe("faellig");
  });
});

describe("Datum hin und zurück", () => {
  it("übersteht die Umwandlung unverändert", () => {
    for (const datum of ["2026-01-01", "2026-03-31", "2026-10-25", "2028-02-29", "2026-12-31"]) {
      expect(alsIsoDatum(ausIsoDatum(datum))).toBe(datum);
    }
  });
});
