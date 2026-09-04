/**
 * Zweitschriften, die auseinanderlaufen können.
 *
 * Manche Regeln stehen zwangsläufig zweimal: einmal dort, wo sie
 * durchgesetzt werden, und einmal dort, wo die Oberfläche schon vorher
 * wissen muss, was durchgehen wird. Das ist vertretbar — aber es **muss
 * auffallen**, wenn die beiden Fassungen auseinanderlaufen.
 *
 * Das Muster stammt aus `tests/domain-rechte.test.ts`: Dort werden die
 * Rechtelisten aus `src/domain/rechte.ts` gegen Migration 009 gehalten.
 * Hier geht es um die Frage, aus welchem Zustand heraus eine Buchungsart
 * zulässig ist.
 *
 * Warum die Oberfläche das überhaupt wissen muss: Eine Sammelbuchung ist
 * alles oder nichts. Schlägt sie vor, ein Zubehörteil zurückzunehmen, das
 * gar nicht ausgegeben ist, scheitert die ganze Rücknahme — mit einer
 * Meldung über ein Teil, das der Benutzer nie angefasst hat.
 */
import { describe, expect, it } from "vitest";
import { BUCHBAR } from "@/composables/useZubehoerwahl";
// Bewusst quer über die Grenze: Der Sinn dieses Tests ist gerade, dass beide
// Seiten dieselbe Datei sehen. Ein Nachbau hier wäre eine dritte Fassung.
import { ERLAUBT } from "../../src/domain/status";

describe("Zubehör: buchbare Zustände", () => {
  it("stimmt für jede Buchungsart mit dem Server überein", () => {
    for (const [art, zustaende] of Object.entries(BUCHBAR)) {
      expect(ERLAUBT[art as keyof typeof ERLAUBT], `Buchungsart ${art}`).toEqual(zustaende);
    }
  });

  it("kennt jede Buchungsart, die die Oberfläche anbietet", () => {
    // `korrektur` fehlt hier absichtlich: Der Knopf „Bestand berichtigen"
    // ist entfernt, die Gegenbuchung läuft nur über die Schnittstelle.
    // Käme sie je zurück, muss dieser Test daran erinnern.
    expect(Object.keys(BUCHBAR).sort()).toEqual(["ausgabe", "ruecknahme", "umbuchung"]);
  });
});
