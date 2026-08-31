/**
 * Die Sammelbuchung in der Oberfläche.
 *
 * Zwei Regeln, die hier festgehalten werden, weil sie leicht kippen:
 *
 * 1. **Zubehör ist vorangehakt, aber abwählbar.** Der Löffel fährt mit dem
 *    Bagger — das ist der Regelfall. Manchmal bleibt er da, und dann darf er
 *    nicht mitgebucht werden, sonst steht er laut System auf der Baustelle.
 * 2. **Nur das Angehakte geht hinaus.** Ein abgewähltes Zubehörteil darf
 *    nicht doch im Aufruf landen.
 *
 * Dazu die Sammlung selbst: Ein zweimal gescanntes Gerät darf sich nicht
 * verdoppeln — zwischendurch abgelenkt zu werden ist der Normalfall.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import SammelBuchenView from "@/views/SammelBuchenView.vue";
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
  useRoute: () => ({ params: { art: "ausgabe" }, query: {} }),
  useRouter: () => ({ push: vi.fn() }),
}));

function geraet(id: string, bezeichnung: string): Geraet {
  return {
    id,
    inventarnummer: id.replace("g", "100"),
    bezeichnung,
    status: "verfuegbar",
    schlagworte: [],
  } as unknown as Geraet;
}

const bagger = geraet("g1", "Minibagger");
const loeffel = { id: "z1", inventarnummer: "10090", bezeichnung: "Tieflöffel 40 cm", status: "verfuegbar", standort: null };
const hammer = { id: "z2", inventarnummer: "10091", bezeichnung: "Hydraulikhammer", status: "verfuegbar", standort: null };

async function baue() {
  setActivePinia(createPinia());
  useAnmeldung().rechte = ["buchungen.erfassen"];
  const bestand = useBestand();
  bestand.geraete = [bagger];
  bestand.standorte = [
    { id: "s1", name: "Baustelle Nord", typ: "baustelle", aktiv: true } as Standort,
  ];
  bestand.laden = vi.fn().mockResolvedValue(undefined);
  bestand.sammle("g1");

  api.get.mockImplementation(async (pfad: string) => {
    if (pfad.includes("/zubehoer")) return [loeffel, hammer];
    if (pfad === "/benutzer") return [{ id: "b1", anzeigename: "Julius" }];
    return [];
  });

  const ansicht = mount(SammelBuchenView, {
    global: { stubs: { Kopf: true, Symbol: true, StatusChip: true } },
  });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

describe("Sammelbuchung", () => {
  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ geraete: [bagger], buchungen: [{ id: "b1" }] });
    api.get.mockReset();
  });

  it("schlägt das Zubehör der gesammelten Geräte vor — vorangehakt", async () => {
    const { ansicht } = await baue();
    expect(ansicht.text()).toContain("Tieflöffel 40 cm");
    expect(ansicht.text()).toContain("Hydraulikhammer");

    const haken = ansicht.findAll('input[type="checkbox"]');
    // Beide Zubehörteile sind angehakt (der dritte Haken ist "Fremdfirma").
    expect(haken.length).toBeGreaterThanOrEqual(2);
    expect((haken[0]!.element as HTMLInputElement).checked).toBe(true);
    expect((haken[1]!.element as HTMLInputElement).checked).toBe(true);
  });

  it("bucht Gerät und Zubehör in EINEM Aufruf", async () => {
    const { ansicht } = await baue();
    await ansicht.findAll("button").find((b) => b.text().includes("buchen"))?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post).toHaveBeenCalledOnce();
    const [pfad, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(pfad).toBe("/buchungen/sammel");
    expect(koerper.geraet_ids).toEqual(["g1", "z1", "z2"]);
  });

  it("lässt abgewähltes Zubehör wirklich weg", async () => {
    const { ansicht } = await baue();
    // Den Hydraulikhammer abwählen — er bleibt im Lager.
    const haken = ansicht.findAll('input[type="checkbox"]');
    await haken[1]!.trigger("change");
    await ansicht.vm.$nextTick();

    await ansicht.findAll("button").find((b) => b.text().includes("buchen"))?.trigger("click");
    await ansicht.vm.$nextTick();

    const [, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(koerper.geraet_ids).toContain("z1");
    expect(koerper.geraet_ids).not.toContain("z2");
  });

  it("nimmt ein Gerät aus der Liste, ohne die anderen zu verlieren", async () => {
    const { ansicht, bestand } = await baue();
    bestand.sammle("g2");
    expect(bestand.sammlung).toEqual(["g1", "g2"]);

    bestand.entsammle("g1");
    await ansicht.vm.$nextTick();
    expect(bestand.sammlung).toEqual(["g2"]);
  });

  it("verdoppelt ein zweimal gescanntes Gerät nicht", async () => {
    const { bestand } = await baue();
    bestand.sammle("g1");
    bestand.sammle("g1");
    expect(bestand.sammlung).toEqual(["g1"]);
  });

  it("zeigt die Fehlermeldung des Servers mitsamt Gerätenamen", async () => {
    const { ansicht } = await baue();
    const { ApiError } = await import("@/api");
    api.post.mockRejectedValue(new ApiError(409, "Minibagger (10001): Das Gerät ist defekt."));

    await ansicht.findAll("button").find((b) => b.text().includes("buchen"))?.trigger("click");
    await ansicht.vm.$nextTick();

    // Ohne den Namen wüsste niemand, welches Gerät aus der Liste muss.
    expect(ansicht.text()).toContain("Minibagger (10001)");
  });
});
