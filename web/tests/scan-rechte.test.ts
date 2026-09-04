/**
 * Buchungs- und Sammelknöpfe der Scan-Ansicht.
 *
 * Diese Ansicht ist die **Landeseite jedes Benutzers** — `/` leitet hierher,
 * und der Wächter schickt auch alles Unbekannte hierher. Was hier steht,
 * sieht also wirklich jeder, auch am Schreibtisch.
 *
 * Zwei Wege führten bis AP25 ohne Recht in den stummen Rückwurf des Routers:
 *
 * * Die Knöpfe der Trefferkarte kamen ungefiltert vom Server und führten auf
 *   `/buchen/:id/:art`.
 * * Der Sammelmodus stand noch **vor jedem Scan** da; wer zehn Geräte
 *   sammelte und „Ausgeben" drückte, landete wortlos in der Geräteliste.
 *
 * Der Kamerazugriff ist stillgelegt (`useScanner` ist ersetzt): Er braucht
 * einen Secure Context und echte Hardware, beides gibt es unter jsdom nicht.
 * Die Trefferkarte entsteht deshalb über die Handeingabe — denselben Weg,
 * den auch der Bauhof nimmt, wenn das Etikett verschmutzt ist.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import ScanView from "@/views/ScanView.vue";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet } from "@/typen";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const geschoben = vi.hoisted(() => vi.fn());

vi.mock("@/api", () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      meldung: string,
    ) {
      super(meldung);
    }
  },
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: geschoben }),
}));

/**
 * Der Leser tut nichts. `starte()` würde `getUserMedia` rufen, das es unter
 * jsdom nicht gibt — und der Treffer kommt in diesem Test ohnehin über die
 * Handeingabe.
 *
 * Der Zustand beginnt bei `startet` und wird nach dem Einhängen auf
 * `kein_zugriff` gesetzt: Die Ansicht öffnet die Handeingabe über einen
 * `watch` ohne `immediate`, ein von Anfang an verweigerter Zugriff löste
 * also gar nichts aus und das Eingabefeld bliebe zu.
 */
const leser = vi.hoisted(() => ({ zustand: null as null | { value: string } }));

vi.mock("@/composables/useScanner", async () => {
  const { ref: erzeuge } = await import("vue");
  const zustand = erzeuge("startet");
  leser.zustand = zustand;
  return {
    useScanner: () => ({
      zustand,
      fehlertext: erzeuge(null),
      lichtMoeglich: erzeuge(false),
      lichtAn: erzeuge(false),
      laeuftSeitMs: erzeuge(0),
      starte: vi.fn(),
      stoppe: vi.fn(),
      weiter: vi.fn(),
      lichtSchalten: vi.fn(),
      beiTreffer: vi.fn(),
    }),
  };
});

const geraet = {
  id: "g1",
  inventarnummer: "10014",
  bezeichnung: "Rüttelplatte",
  status: "verfuegbar",
  standort: "Bauhof Nord",
  lagerplatz: "Regal C3",
  nutzer: null,
  schlagworte: [],
  zubehoer: [],
} as unknown as Geraet;

async function baue(rechte: string[]) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;
  const bestand = useBestand();
  bestand.laden = vi.fn().mockResolvedValue(undefined);
  bestand.geraete = [geraet];

  // Der Leser ist ein Modul-Singleton und behält seinen Zustand über alle
  // Aufbauten hinweg. Ohne dieses Zurücksetzen stünde er beim zweiten
  // Aufbau schon auf `kein_zugriff`, der `watch` bekäme keine Änderung mehr
  // zu sehen und die Handeingabe bliebe zu.
  leser.zustand!.value = "startet";

  const ansicht = mount(ScanView, {
    global: { stubs: { Symbol: true, StatusChip: true } },
  });
  await new Promise((f) => setTimeout(f, 0));
  // Kamera verweigert → die Ansicht öffnet die Handeingabe von selbst.
  leser.zustand!.value = "kein_zugriff";
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

/** Eine Nummer eintippen und suchen — so entsteht die Trefferkarte. */
async function nachschlagen(ansicht: Awaited<ReturnType<typeof baue>>["ansicht"]) {
  api.get.mockResolvedValue({
    typ: "geraet",
    code: "10014",
    geraet,
    aktionen: [
      { art: "ausgabe", text: "Ausgeben", hauptaktion: true },
      { art: "umbuchung", text: "Umbuchen", hauptaktion: false },
    ],
    hinweis: null,
    letzteBuchung: null,
    warnungen: [],
  });
  await ansicht.find("#nummer").setValue("10014");
  await ansicht.find("#nummer").trigger("keyup.enter");
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
}

function knopftexte(ansicht: Awaited<ReturnType<typeof baue>>["ansicht"]): string[] {
  return ansicht
    .findAll("button")
    .map((k) => k.text().trim())
    .filter(Boolean);
}

describe("Scan-Ansicht: Rechte an den Knöpfen", () => {
  beforeEach(() => {
    geschoben.mockReset();
    api.get.mockReset();
  });

  it("bietet die Buchungen des Servers an, wenn das Recht da ist", async () => {
    const { ansicht } = await baue(["buchungen.erfassen"]);
    await nachschlagen(ansicht);

    const texte = knopftexte(ansicht);
    expect(texte).toContain("Ausgeben");
    expect(texte).toContain("Umbuchen");
    // Der Weg zum Gerät bleibt jedem offen — Lesen ist kein Recht.
    expect(texte).toContain("Details ansehen");
  });

  it("blendet die Buchungen ohne buchungen.erfassen aus", async () => {
    const { ansicht } = await baue(["schaeden.melden"]);
    await nachschlagen(ansicht);

    const texte = knopftexte(ansicht);
    expect(texte).not.toContain("Ausgeben");
    expect(texte).not.toContain("Umbuchen");
    // Die Karte selbst steht trotzdem, samt Standortsatz.
    expect(ansicht.text()).toContain("Regal C3");
    expect(texte).toContain("Details ansehen");
  });

  it("zeigt den Sammelmodus nur mit dem Recht zu buchen", async () => {
    const mit = await baue(["buchungen.erfassen"]);
    expect(mit.ansicht.find(".sammelleiste").exists()).toBe(true);
    expect(mit.ansicht.text()).toContain("Mehrere sammeln");

    const ohne = await baue(["schaeden.melden"]);
    expect(ohne.ansicht.find(".sammelleiste").exists()).toBe(false);
    expect(ohne.ansicht.text()).not.toContain("Mehrere sammeln");
  });

  it("hält die Sammelliste samt ihrer Knöpfe ohne das Recht zurück", async () => {
    // Die Sammlung kann von anderswo gefüllt sein — aus der Paketansicht
    // etwa. Ohne Recht darf daraus trotzdem kein Weg nach /sammeln führen.
    const ohne = await baue(["schaeden.melden"]);
    ohne.bestand.sammlung = ["g1"];
    await ohne.ansicht.vm.$nextTick();
    expect(ohne.ansicht.find(".sammlung").exists()).toBe(false);
    expect(knopftexte(ohne.ansicht)).not.toContain("Zurücknehmen");

    const mit = await baue(["buchungen.erfassen"]);
    mit.bestand.sammlung = ["g1"];
    await mit.ansicht.vm.$nextTick();
    expect(mit.ansicht.find(".sammlung").exists()).toBe(true);
    expect(knopftexte(mit.ansicht)).toContain("Zurücknehmen");
  });

  it("führt einen erlaubten Buchungsknopf auf /buchen/:id/:art", async () => {
    const { ansicht } = await baue(["buchungen.erfassen"]);
    await nachschlagen(ansicht);

    const knopf = ansicht.findAll("button").find((k) => k.text().trim() === "Ausgeben");
    await knopf!.trigger("click");
    expect(geschoben).toHaveBeenCalledWith("/buchen/g1/ausgabe");
  });
});
