/**
 * „Gerät ist defekt" bei der Rücknahme — auf der Handy-Seite.
 *
 * Der Fall, um den es geht: Der Bagger kommt kaputt zurück. Bis AP25 war der
 * Haken ein Feld an der Buchung, und beim Weg MIT Zubehör ließen ihn beide
 * Ansichten stillschweigend weg — sonst hätte `bucheMehrere` den Löffel
 * gleich mitgesperrt. Ergebnis: Der Bagger stand auf `verfuegbar` und wurde
 * am nächsten Morgen wieder ausgegeben.
 *
 * Jetzt wird ein Schaden gemeldet (`POST /geraete/:id/schaeden`, Schwere
 * `ausfall`). Der Server setzt den Zustand danach selbst auf `defekt`, weil
 * das Gerät nach der Rücknahme nicht mehr `ausgegeben` ist — und der Schaden
 * lässt sich später normal erledigen, was ein per Buchung gesperrtes Gerät
 * nicht zulässt.
 *
 * Der Dialog am Computer wird in `buchen-dialog.test.ts` geprüft. Beide
 * Wege getrennt: Es sind zwei `buchen()`, und genau daran ist die Regel
 * vorher auseinandergelaufen.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import BuchenView from "@/views/BuchenView.vue";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Standort } from "@/typen";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

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
  useRoute: () => ({ params: { id: "g1", art: "ruecknahme" }, query: {} }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@/composables/useFoto", () => ({
  useFoto: () => ({
    arbeitet: { value: false },
    fehler: { value: null },
    vorbereiten: vi.fn(),
  }),
}));

const bagger = {
  id: "g1",
  inventarnummer: "10001",
  bezeichnung: "Minibagger",
  status: "ausgegeben",
  schlagworte: [],
} as unknown as Geraet;

/** Nur ein ausgegebenes Zubehörteil lässt sich zurücknehmen. */
const loeffel = {
  id: "z1",
  inventarnummer: "10090",
  bezeichnung: "Tieflöffel 40 cm",
  status: "ausgegeben",
  standort: null,
};

const RECHTE = ["buchungen.erfassen", "schaeden.melden"];

async function baue(opts: { rechte?: string[]; zubehoer?: unknown[] } = {}) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = opts.rechte ?? RECHTE;

  const bestand = useBestand();
  bestand.geraete = [bagger];
  bestand.standorte = [{ id: "s2", name: "Bauhof Nord", typ: "lager", aktiv: true } as Standort];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  api.get.mockImplementation(async (pfad: string) => {
    if (pfad.includes("/zubehoer")) return opts.zubehoer ?? [];
    if (pfad === "/benutzer") return [{ id: "b1", anzeigename: "Julius" }];
    return bagger;
  });

  const ansicht = mount(BuchenView, {
    global: { stubs: { Kopf: true, Symbol: true, StatusChip: true, RouterLink: true } },
  });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

type Ansicht = Awaited<ReturnType<typeof baue>>["ansicht"];

const knopf = (a: Ansicht, text: string) => a.findAll("button").find((b) => b.text() === text);

/** Buchen und beide Schritte abwarten: erst die Buchung, dann die Meldung. */
async function zurueckAnkreuzenUndBuchen(ansicht: Ansicht) {
  await ansicht.find('input[type="checkbox"]').setValue(true);
  await knopf(ansicht, "Zurücknehmen")?.trigger("click");
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
}

const schaedenPfade = () =>
  api.post.mock.calls.filter((c) => String(c[0]).endsWith("/schaeden")) as [string, never][];

describe("Defekt bei der Rücknahme", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset().mockImplementation(async (pfad: string) => {
      if (pfad === "/buchungen/ruecknahme-defekt") {
        return { buchung_id: "b-eigene", schaden: { id: "s-1" }, geraet: { ...bagger, status: "defekt" } };
      }
      if (pfad.endsWith("/schaeden")) {
        return { schaden: { id: "s-1" }, geraet: { ...bagger, status: "defekt" } };
      }
      if (pfad === "/buchungen/sammel") {
        return {
          geraete: [{ ...bagger, status: "verfuegbar" }],
          buchungen: [
            { id: "b-zubehoer", geraet_id: "z1" },
            { id: "b-eigene", geraet_id: "g1" },
          ],
        };
      }
      return { geraet: { ...bagger, status: "verfuegbar" }, buchung: { id: "b-eigene" } };
    });
  });

  it("bucht Rücknahme und Defekt in einer Transaktion", async () => {
    const { ansicht } = await baue();
    await zurueckAnkreuzenUndBuchen(ansicht);

    // Ohne Zubehör geht alles in EINEM Aufruf.
    expect(api.post).toHaveBeenCalledOnce();
    const [pfad, koerper] = api.post.mock.calls[0] as [string, { beschreibung: string }];
    expect(pfad).toBe("/buchungen/ruecknahme-defekt");
    expect(koerper.beschreibung).toContain("Bei der Rücknahme als defekt gemeldet");
  });

  it("meldet den Defekt auch, wenn Zubehör mitgeht — und nur für das Gerät", async () => {
    // Genau dieser Weg verschluckte den Haken bis AP25.
    const { ansicht } = await baue({ zubehoer: [loeffel] });
    await zurueckAnkreuzenUndBuchen(ansicht);

    expect(api.post.mock.calls[0]![0]).toBe("/buchungen/sammel");
    const gemeldet = schaedenPfade();
    expect(gemeldet).toHaveLength(1);
    expect(gemeldet[0]![0]).toBe("/geraete/g1/schaeden");
  });

  it("zeigt den Zustand aus der transaktionalen Antwort", async () => {
    // Die transaktionale Route liefert das Gerät direkt mit status „defekt".
    const { ansicht, bestand } = await baue();
    await zurueckAnkreuzenUndBuchen(ansicht);
    expect(bestand.geraete[0]!.status).toBe("defekt");
  });

  it("lässt die Buchung stehen, wenn die Schadensmeldung scheitert", async () => {
    // Nur beim Sammelweg (MIT Zubehör) sind Buchung und Schadensmeldung zwei
    // getrennte Aufrufe — der Einzelweg läuft transaktional.
    const { ApiError } = await import("@/api");
    const vorher = api.post.getMockImplementation()!;
    api.post.mockImplementation(async (pfad: string, koerper?: unknown) => {
      if (pfad.endsWith("/schaeden")) throw new ApiError(403, "Keine Berechtigung.");
      return vorher(pfad, koerper);
    });

    const { ansicht } = await baue({ zubehoer: [loeffel] });
    await zurueckAnkreuzenUndBuchen(ansicht);

    // Die Rücknahme steht — die Bestätigungsseite ist da …
    expect(ansicht.text()).toContain("Zurückgenommen");
    // … und der Benutzer erfährt, dass das Gerät NICHT gesperrt ist.
    expect(ansicht.text()).toContain("der Defekt konnte nicht gemeldet werden");
  });

  it("zeigt den Schalter ohne schaeden.melden gar nicht erst", async () => {
    const { ansicht } = await baue({ rechte: ["buchungen.erfassen"] });
    expect(ansicht.text()).not.toContain("Gerät ist defekt");
    expect(ansicht.find('input[type="checkbox"]').exists()).toBe(false);
    // Der Hauptweg bleibt bedienbar.
    expect(knopf(ansicht, "Zurücknehmen")).toBeDefined();
  });

  it("bietet nur Zubehör an, das überhaupt zurückgenommen werden kann", async () => {
    // Ein Teil, das im Regal geblieben ist, ließe die Alles-oder-nichts-
    // Buchung scheitern — mit einer Meldung über etwas, das der Benutzer nie
    // angefasst hat.
    const daheim = { ...loeffel, id: "z2", bezeichnung: "Räumschild", status: "verfuegbar" };
    const { ansicht } = await baue({ zubehoer: [loeffel, daheim] });
    expect(ansicht.text()).toContain("Tieflöffel 40 cm");
    expect(ansicht.text()).not.toContain("Räumschild");
  });
});
