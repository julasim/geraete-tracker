/**
 * Die Suche im Bestand — und ihre Reihenfolge.
 *
 * Der Anlass: Wer auf der Baustelle die Nummer vom Etikett abtippt (weil die
 * Kamera streikt oder der Aufkleber verschmutzt ist), bekam die Treffer
 * alphabetisch nach Gerätenamen. Eingabe `1001` ergab 10011, 10010, 10015 —
 * man musste die eigene Nummer in der Liste suchen.
 *
 * Diese Datei hält die Regel fest, damit sie nicht wieder verlorengeht.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBestand } from "@/stores/bestand";
import type { Geraet } from "@/typen";

/** Ein Gerät mit den Feldern, welche die Suche anfasst. */
function geraet(nummer: string, bezeichnung: string, extra: Partial<Geraet> = {}): Geraet {
  return {
    id: `id-${nummer}`,
    inventarnummer: nummer,
    bezeichnung,
    hersteller: null,
    modell: null,
    seriennummer: null,
    status: "verfuegbar",
    standort: null,
    nutzer: null,
    schlagworte: [],
    ...extra,
  } as Geraet;
}

describe("Suche im Bestand", () => {
  let bestand: ReturnType<typeof useBestand>;

  beforeEach(() => {
    setActivePinia(createPinia());
    bestand = useBestand();
    // Absichtlich in einer Reihenfolge, die nach Bezeichnung sortiert ist —
    // genau so kommt die Liste vom Server, und genau daran lag der Fehler.
    bestand.geraete = [
      geraet("10011", "Baustellenkreissäge"),
      geraet("10010", "Bautrockner"),
      geraet("10015", "Erdbohrer"),
      geraet("10100", "Kernbohrgerät"),
      geraet("10012", "Rüttelflasche"),
      geraet("20500", "Zange", { hersteller: "Knipex" }),
    ];
  });

  it("sortiert eine reine Ziffernfolge nach Nummer, nicht nach Namen", () => {
    const treffer = bestand.suche("1001");
    // 10015 gehört dazu: "1001" ist auch dort das Präfix. Beim Schreiben
    // dieses Tests zunächst übersehen — die Suite hat es sofort gemeldet.
    expect(treffer.map((g) => g.inventarnummer)).toEqual(["10010", "10011", "10012", "10015"]);
  });

  it("vergleicht Nummern als Zahl, nicht als Text", () => {
    // Der klassische Stolperstein: Als Text sortiert stünde "10100" vor
    // "10011", weil "0" < "1" an der dritten Stelle.
    const treffer = bestand.suche("10");
    const nummern = treffer.map((g) => Number(g.inventarnummer));
    expect(nummern).toEqual([...nummern].sort((a, b) => a - b));
    expect(nummern.indexOf(10100)).toBeGreaterThan(nummern.indexOf(10011));
  });

  it("stellt Nummern nach vorn, die mit der Eingabe beginnen", () => {
    // "100" steckt auch in 10100 mitten drin, aber die Nummern, die damit
    // ANFANGEN, sind die wahrscheinlicheren Treffer.
    const treffer = bestand.suche("100");
    expect(treffer[0]?.inventarnummer).toBe("10010");
  });

  it("lässt die Reihenfolge bei einer Textsuche unangetastet", () => {
    // Bei Wörtern gibt es keine natürliche Ordnung — die Liste kommt schon
    // alphabetisch vom Server, und Umsortieren wäre hier reine Willkür.
    const treffer = bestand.suche("bau");
    expect(treffer.map((g) => g.bezeichnung)).toEqual(["Baustellenkreissäge", "Bautrockner"]);
  });

  it("findet über alle Felder, die auf einem Typenschild stehen", () => {
    expect(bestand.suche("knipex").map((g) => g.inventarnummer)).toEqual(["20500"]);
  });

  it("verlangt, dass alle Wörter vorkommen — Reihenfolge egal", () => {
    expect(bestand.suche("zange knipex")).toHaveLength(1);
    expect(bestand.suche("knipex zange")).toHaveLength(1);
    expect(bestand.suche("zange hilti")).toHaveLength(0);
  });

  it("gibt bei leerer Eingabe den ganzen Bestand zurück", () => {
    expect(bestand.suche("   ")).toHaveLength(6);
  });
});
