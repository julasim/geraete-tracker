/**
 * Neu angelegte Stammdaten müssen sofort überall auftauchen.
 *
 * Julius' Vorgabe beim Einbau der Baustellen-Anlage: „Wenn eine einmal
 * eingetragen ist, dann ist sie automatisch hinterlegt." Genau dafür stehen
 * diese Funktionen — sie pflegen einen neuen Datensatz in den geladenen
 * Bestand ein, damit kein Neuladen der ~200 Geräte nötig ist (über Mobilfunk
 * auf der Baustelle ein spürbarer Unterschied).
 *
 * Ohne Test wäre das eine stille Falle: Vergisst jemand den Aufruf, merkt man
 * es erst, wenn eine gerade angelegte Baustelle im Auswahlfeld fehlt.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Lagerplatz, Schlagwort, Standort } from "@/typen";

function standort(id: string, name: string, aktiv = true): Standort {
  return { id, name, typ: "baustelle", adresse: null, notiz: null, aktiv } as Standort;
}

describe("Stammdaten im geladenen Bestand pflegen", () => {
  let bestand: ReturnType<typeof useBestand>;

  beforeEach(() => {
    setActivePinia(createPinia());
    bestand = useBestand();
  });

  describe("Standorte", () => {
    it("nimmt einen neuen Ort auf", () => {
      bestand.ergaenzeStandort(standort("s1", "Lindengasse 14"));
      expect(bestand.standorte).toHaveLength(1);
      expect(bestand.aktiveStandorte.map((s) => s.name)).toEqual(["Lindengasse 14"]);
    });

    it("ersetzt einen vorhandenen Ort, statt ihn zu verdoppeln", () => {
      bestand.ergaenzeStandort(standort("s1", "Lindengasse"));
      bestand.ergaenzeStandort(standort("s1", "Lindengasse 14"));
      expect(bestand.standorte).toHaveLength(1);
      expect(bestand.standorte[0]?.name).toBe("Lindengasse 14");
    });

    it("nimmt einen stillgelegten Ort aus der Auswahl, behält ihn aber", () => {
      bestand.ergaenzeStandort(standort("s1", "Alte Baustelle"));
      bestand.ergaenzeStandort(standort("s1", "Alte Baustelle", false));
      // Wichtig: NICHT gelöscht — der Name steht in jeder Buchung, die
      // dorthin ging, und die Historie muss lesbar bleiben.
      expect(bestand.standorte).toHaveLength(1);
      expect(bestand.aktiveStandorte).toHaveLength(0);
    });
  });

  describe("Lagerplätze", () => {
    it("nimmt einen neuen Platz auf und ordnet ihn seinem Ort zu", () => {
      const platz = {
        id: "p1",
        standort_id: "s1",
        bezeichnung: "Regal C3",
        barcode: "P-0007",
        typ: "regal",
        notiz: null,
        aktiv: true,
      } as Lagerplatz;
      bestand.ergaenzeLagerplatz(platz);
      expect(bestand.plaetzeAmStandort("s1").map((p) => p.bezeichnung)).toEqual(["Regal C3"]);
      expect(bestand.plaetzeAmStandort("s2")).toHaveLength(0);
    });

    it("ersetzt beim Umbenennen, statt einen zweiten anzulegen", () => {
      const platz = (bezeichnung: string) =>
        ({
          id: "p1",
          standort_id: "s1",
          bezeichnung,
          barcode: "P-0007",
          typ: "regal",
          notiz: null,
          aktiv: true,
        }) as Lagerplatz;
      bestand.ergaenzeLagerplatz(platz("Regal C3"));
      bestand.ergaenzeLagerplatz(platz("Regal C3 hinten"));
      expect(bestand.lagerplaetze).toHaveLength(1);
      expect(bestand.lagerplaetze[0]?.bezeichnung).toBe("Regal C3 hinten");
    });
  });

  describe("Schlagworte", () => {
    const wort = (id: string, name: string) => ({ id, name, farbe: null }) as Schlagwort;

    it("nimmt ein neues Schlagwort auf und ersetzt beim Umbenennen", () => {
      bestand.ergaenzeSchlagwort(wort("w1", "Verdichtung"));
      bestand.ergaenzeSchlagwort(wort("w1", "Verdichtungsgeräte"));
      expect(bestand.schlagworte).toHaveLength(1);
      expect(bestand.schlagworte[0]?.name).toBe("Verdichtungsgeräte");
    });

    it("entfernt ein gelöschtes Schlagwort AUCH an den Geräten", () => {
      // Der eigentliche Grund für diesen Test: Ohne das Aufräumen an den
      // Geräten zeigt die Liste ein Schlagwort weiter an, das es nicht mehr
      // gibt — bis jemand die Seite neu lädt.
      bestand.ergaenzeSchlagwort(wort("w1", "Verdichtung"));
      bestand.ergaenzeSchlagwort(wort("w2", "Messtechnik"));
      bestand.geraete = [
        {
          id: "g1",
          inventarnummer: "10001",
          bezeichnung: "Rüttelplatte",
          status: "verfuegbar",
          schlagworte: [wort("w1", "Verdichtung"), wort("w2", "Messtechnik")],
        } as unknown as Geraet,
      ];

      bestand.entferneSchlagwort("w1");

      expect(bestand.schlagworte.map((w) => w.id)).toEqual(["w2"]);
      expect(bestand.geraete[0]?.schlagworte.map((w) => w.id)).toEqual(["w2"]);
    });

    it("verträgt ein Gerät ohne Schlagworte", () => {
      bestand.geraete = [
        { id: "g1", inventarnummer: "10001", bezeichnung: "Bagger" } as unknown as Geraet,
      ];
      expect(() => bestand.entferneSchlagwort("w1")).not.toThrow();
    });
  });
});
