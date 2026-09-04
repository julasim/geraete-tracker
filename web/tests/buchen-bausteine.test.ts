/**
 * Die reinen Bausteine der Buchung — ohne Vue, ohne jsdom.
 *
 * Alle drei standen vor AP25 mehrfach im Quelltext: die Dublettenwarnung
 * dreimal, die Fehlerkette viermal, der Buchungskörper viermal. Sie sind
 * jetzt Funktionen ohne Zustand und lassen sich deshalb einzeln festnageln —
 * was bei einer Kopie in einer 700-Zeilen-Ansicht nie ging.
 */

import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { aehnlicherOrt } from "@/orte";
import { meldungAus } from "@/meldung";
import { buchungsRumpf, type Buchungsangaben } from "@/buchen";
import type { Standort } from "@/typen";
import { useEmpfaenger } from "@/composables/useEmpfaenger";
import { useAnmeldung } from "@/stores/anmeldung";

function ort(id: string, name: string): Standort {
  return { id, name, typ: "baustelle", adresse: null, notiz: null, aktiv: true } as Standort;
}

const ORTE = [ort("s1", "Bauhof Nord"), ort("s2", "Lindengasse 14")];

describe("aehnlicherOrt", () => {
  it("erkennt einen Ort unabhängig von der Groß- und Kleinschreibung", () => {
    expect(aehnlicherOrt("bauhof nord", ORTE)?.id).toBe("s1");
  });

  it("erkennt auch das Teilstück in beide Richtungen", () => {
    // Der eigentliche Zweck: Sonst stehen „Lindengasse", „Lindengasse 14"
    // und „lindengasse" nebeneinander, und der Bestand verteilt sich auf
    // drei Orte, die dasselbe meinen.
    expect(aehnlicherOrt("Lindengasse", ORTE)?.id).toBe("s2");
    expect(aehnlicherOrt("Lindengasse 14a", ORTE)?.id).toBe("s2");
  });

  it("schweigt unter drei Zeichen", () => {
    // „Li" steckt in jedem zweiten Straßennamen. Eine Warnung bei jedem
    // Tastendruck liest bald niemand mehr.
    expect(aehnlicherOrt("Li", ORTE)).toBe(null);
    expect(aehnlicherOrt("  L  ", ORTE)).toBe(null);
  });

  it("meldet nichts, wenn es nichts Ähnliches gibt", () => {
    expect(aehnlicherOrt("Ahornweg", ORTE)).toBe(null);
  });
});

describe("meldungAus", () => {
  it("reicht den Wortlaut des Servers unverändert durch", () => {
    // `SammelPanel` erkennt das schuldige Gerät allein am Anfang dieser
    // Meldung wieder — sie darf keinen Zusatz davor bekommen.
    const meldung = "Rüttelplatte (10011): Dieses Gerät ist bereits ausgegeben.";
    expect(meldungAus(new Error(meldung), "Buchung fehlgeschlagen")).toBe(meldung);
  });

  it("nimmt den Ersatztext, wenn gar kein Fehlerobjekt kam", () => {
    expect(meldungAus("kaputt", "Buchung fehlgeschlagen")).toBe("Buchung fehlgeschlagen");
    expect(meldungAus(undefined, "Buchung fehlgeschlagen")).toBe("Buchung fehlgeschlagen");
  });

  it("nimmt den Ersatztext auch bei einem Fehler ohne Text", () => {
    // Ein leerer Satz wäre schlimmer als ein allgemeiner: Der Benutzer sähe
    // eine Meldung, die nichts sagt.
    expect(meldungAus(new Error(""), "Buchung fehlgeschlagen")).toBe("Buchung fehlgeschlagen");
  });
});

describe("buchungsRumpf", () => {
  const angaben: Buchungsangaben = {
    art: "ausgabe",
    standortId: "s1",
    lagerplatzId: "",
    empfaenger: { empfaenger_id: "b1", empfaenger_freitext: null },
    rueckgabe: "",
    notiz: "",
  };

  it("macht aus leeren Feldern null, nicht leeren Text", () => {
    // In der Buchungszeile ist „nicht angegeben" etwas anderes als ein
    // leerer Text — und die Zeile lässt sich nachher nicht mehr berichtigen.
    const rumpf = buchungsRumpf(angaben);
    expect(rumpf.nach_lagerplatz_id).toBe(null);
    expect(rumpf.geplante_rueckgabe).toBe(null);
    expect(rumpf.notiz).toBe(null);
    expect(rumpf.nach_standort_id).toBe("s1");
  });

  it("schickt kein Sperrflag mit", () => {
    // `bucheMehrere` reicht den Rumpf unverändert an JEDES Gerät weiter —
    // ein `ausfall` darin sperrte den Löffel mit dem Bagger.
    expect("ausfall" in buchungsRumpf(angaben)).toBe(false);
  });

  it("übernimmt die Empfängerfelder unverändert", () => {
    // Der Name sagte früher „trägt entweder Konto oder Freitext, nie beides".
    // Das war eine Attrappe: `buchungsRumpf` reicht die Felder nur durch, die
    // Regel selbst steht in `useEmpfaenger.empfaengerFelder` — und wurde von
    // keinem Test berührt. Sie wird jetzt unten geprüft, dort wo sie steht.
    const frei = buchungsRumpf({
      ...angaben,
      empfaenger: { empfaenger_id: null, empfaenger_freitext: "Fa. Huber" },
    });
    expect(frei.empfaenger_id).toBe(null);
    expect(frei.empfaenger_freitext).toBe("Fa. Huber");
  });
});

/**
 * Die Regel, die der Rumpf nur durchreicht.
 *
 * Sie steht in `useEmpfaenger` und war lange ungeprüft — der Test, der sie
 * zu prüfen behauptete, sah in Wahrheit nur den Durchreicher. Genau die
 * Fehlerart, die diesem Projekt inzwischen siebenmal passiert ist.
 */
describe("useEmpfaenger: Konto oder Freitext", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    const anmeldung = useAnmeldung();
    anmeldung.benutzer = {
      id: "u1",
      benutzername: "julius",
      anzeigename: "Julius",
      email: null,
      rolle: "verwaltung",
    };
    anmeldung.rechte = ["buchungen.erfassen"];
  });

  it("gibt im Normalfall das Konto und keinen Freitext", () => {
    const e = useEmpfaenger();
    e.empfaengerId.value = "u2";
    e.empfaengerFrei.value = "sollte nicht mitgehen";
    expect(e.empfaengerFelder.value).toEqual({
      empfaenger_id: "u2",
      empfaenger_freitext: null,
    });
  });

  it("verwirft das Konto, sobald die Fremdfirma gesetzt ist", () => {
    // Sonst stünden beide Felder in einer unveränderlichen Buchungszeile —
    // korrigierbar nur noch per Gegenbuchung.
    const e = useEmpfaenger();
    e.empfaengerId.value = "u2";
    e.empfaengerFrei.value = "Fa. Huber";
    e.fremdfirma.value = true;
    expect(e.empfaengerFelder.value).toEqual({
      empfaenger_id: null,
      empfaenger_freitext: "Fa. Huber",
    });
  });

  it("schickt ein leeres Konto als null, nicht als leere Zeichenkette", () => {
    const e = useEmpfaenger();
    e.empfaengerId.value = "";
    expect(e.empfaengerFelder.value.empfaenger_id).toBe(null);
  });
});
