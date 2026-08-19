/**
 * Der Rechte-Katalog. Reine Fachlogik, keine Datenbank.
 *
 * Der wichtigste Test hier ist der letzte: Die Rechtelisten stehen doppelt —
 * einmal in `src/domain/rechte.ts` und einmal in Migration 009. Das ist
 * unvermeidlich (die Migration muss ohne Anwendungscode laufen, der Code
 * ohne Datenbank testbar bleiben), aber es muss auffallen, wenn beide
 * auseinanderlaufen.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hatRecht,
  istRecht,
  RECHTE,
  RECHT_TEXT,
  rechteNachGruppe,
  ROLLEN_VORGABEN,
} from "../src/domain/rechte.js";

describe("Katalog", () => {
  it("hat zu jedem Recht einen Text", () => {
    // Sonst stünde in der Rollenverwaltung ein nackter Bezeichner.
    for (const recht of RECHTE) {
      expect(RECHT_TEXT[recht]).toBeTruthy();
      expect(RECHT_TEXT[recht].titel.length).toBeGreaterThan(3);
      expect(RECHT_TEXT[recht].erklaerung.length).toBeGreaterThan(10);
    }
  });

  it("enthält keine doppelten Rechte", () => {
    expect(new Set(RECHTE).size).toBe(RECHTE.length);
  });

  it("erkennt bekannte und unbekannte Rechte", () => {
    expect(istRecht("geraete.pflegen")).toBe(true);
    expect(istRecht("geraete.zaubern")).toBe(false);
    expect(istRecht("")).toBe(false);
  });

  it("gruppiert alle Rechte lückenlos", () => {
    const gruppiert = rechteNachGruppe().flatMap((g) => g.rechte);
    expect(gruppiert.sort()).toEqual([...RECHTE].sort());
  });
});

describe("hatRecht", () => {
  it("erlaubt, was in der Liste steht", () => {
    expect(hatRecht(["geraete.pflegen"], "geraete.pflegen")).toBe(true);
  });

  it("verweigert, was fehlt", () => {
    expect(hatRecht(["geraete.pflegen"], "benutzer.verwalten")).toBe(false);
    expect(hatRecht([], "buchungen.erfassen")).toBe(false);
  });

  it("kennt keinen Freifahrtschein", () => {
    // Eine eingebaute Ausnahme für eine "Superrolle" wäre genau die Art
    // Sonderfall, die man beim nächsten Umbau übersieht. Wer alles darf,
    // hat alles eingetragen.
    expect(hatRecht(["admin"], "benutzer.verwalten")).toBe(false);
    expect(hatRecht(["*"], "benutzer.verwalten")).toBe(false);
  });
});

describe("Die drei mitgelieferten Rollen", () => {
  const rolle = (id: string) => ROLLEN_VORGABEN.find((r) => r.id === id)!;

  it("gibt es alle drei", () => {
    expect(ROLLEN_VORGABEN.map((r) => r.id)).toEqual(["mitarbeiter", "lager", "verwaltung"]);
  });

  it("lässt Mitarbeiter buchen, aber keine Stammdaten ändern", () => {
    const m = rolle("mitarbeiter").rechte;
    expect(m).toContain("buchungen.erfassen");
    expect(m).toContain("schaeden.melden");
    expect(m).not.toContain("geraete.pflegen");
    expect(m).not.toContain("benutzer.verwalten");
  });

  it("lässt Lager und Werkstatt den Bauhof führen, aber keine Konten anlegen", () => {
    const l = rolle("lager").rechte;
    expect(l).toContain("geraete.pflegen");
    expect(l).toContain("pruefungen.eintragen");
    expect(l).toContain("etiketten.drucken");
    // Die folgenreichen bleiben bei der Verwaltung.
    expect(l).not.toContain("benutzer.verwalten");
    expect(l).not.toContain("daten.austauschen");
    expect(l).not.toContain("geraete.ausmustern");
    expect(l).not.toContain("buchungen.korrigieren");
  });

  it("gibt der Verwaltung alles", () => {
    expect([...rolle("verwaltung").rechte].sort()).toEqual([...RECHTE].sort());
  });

  it("staffelt die Rollen aufeinander auf", () => {
    // Wer mehr darf, darf auch alles, was die Stufe darunter darf — sonst
    // gäbe es Lücken, die niemand erwartet.
    const m = new Set(rolle("mitarbeiter").rechte);
    const l = new Set(rolle("lager").rechte);
    const v = new Set(rolle("verwaltung").rechte);
    for (const recht of m) expect(l.has(recht)).toBe(true);
    for (const recht of l) expect(v.has(recht)).toBe(true);
  });
});

describe("Code und Migration stimmen überein", () => {
  it("führt in Migration 009 dieselben Rechte je Rolle wie im Katalog", () => {
    // Die Listen stehen doppelt — das ist unvermeidlich, muss aber
    // auffallen, wenn sie auseinanderlaufen.
    const sql = readFileSync("src/db/migrations/009_rollen.sql", "utf8");

    for (const rolle of ROLLEN_VORGABEN) {
      // Den ARRAY[...]-Block dieser Rolle aus dem SQL holen
      const start = sql.indexOf(`('${rolle.id}',`);
      expect(start, `Rolle ${rolle.id} fehlt in der Migration`).toBeGreaterThan(0);

      const arrayStart = sql.indexOf("ARRAY[", start);
      const arrayEnde = sql.indexOf("]", arrayStart);
      const block = sql.slice(arrayStart, arrayEnde);

      const imSql = [...block.matchAll(/'([a-z.]+)'/g)].map((m) => m[1]!);
      expect(imSql.sort(), `Rechte von "${rolle.id}" weichen ab`).toEqual(
        [...rolle.rechte].sort(),
      );
    }
  });
});
