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

/** Die Buchungsart steht in der Adresse; sie ist je Test umstellbar. */
const route = vi.hoisted(() => ({ params: { art: "ausgabe" }, query: {} }));

vi.mock("vue-router", () => ({
  useRoute: () => route,
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
/** Ein zweites Gerät OHNE eigenes Zubehör — es dient nur dazu, die Liste zu
 *  verändern, ohne dass dabei das Zubehör des Baggers verschwindet. */
const walze = geraet("g2", "Walze Bomag");
const loeffel = { id: "z1", inventarnummer: "10090", bezeichnung: "Tieflöffel 40 cm", status: "verfuegbar", standort: null };
const hammer = { id: "z2", inventarnummer: "10091", bezeichnung: "Hydraulikhammer", status: "verfuegbar", standort: null };

async function baue(sammlung = ["g1"]) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = ["buchungen.erfassen"];
  const bestand = useBestand();
  bestand.geraete = [bagger, walze];
  bestand.standorte = [
    { id: "s1", name: "Baustelle Nord", typ: "baustelle", aktiv: true } as Standort,
    { id: "s2", name: "Bauhof Nord", typ: "lager", aktiv: true } as Standort,
  ];
  bestand.laden = vi.fn().mockResolvedValue(undefined);
  for (const id of sammlung) bestand.sammle(id);

  // Je Gerät ein eigener Mock: Läge dieselbe Liste hinter jedem Pfad, änderte
  // das Entfernen eines Geräts am Zubehör gar nichts — eine Gegenprobe dazu
  // bliebe grün, ohne etwas zu belegen.
  api.get.mockImplementation(async (pfad: string) => {
    if (pfad === "/geraete/g1/zubehoer") return [loeffel, hammer];
    if (pfad.includes("/zubehoer")) return [];
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
    route.params.art = "ausgabe";
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

  it("hakt abgewähltes Zubehör nicht wieder an, wenn sich die Liste ändert", async () => {
    // Der schwerste der fünf Fehler aus AP25: `zubehoerLaden` setzte die
    // Auswahl bedingungslos auf ALLE zurück, und es lief bei jeder Änderung
    // der Sammlung. Wer den Hammer abwählte und danach ein Gerät entfernte,
    // buchte ihn hinaus.
    const { ansicht, bestand } = await baue(["g1", "g2"]);

    const haken = ansicht.findAll('input[type="checkbox"]');
    await haken[1]!.trigger("change"); // Hydraulikhammer abwählen
    await ansicht.vm.$nextTick();

    // Die Walze aus der Liste nehmen — NICHT den Bagger: An ihm hängt das
    // Zubehör, mit ihm verschwände es, und die Prüfung beliefe nichts.
    bestand.entsammle("g2");
    await new Promise((f) => setTimeout(f, 0));
    await ansicht.vm.$nextTick();

    expect(ansicht.text()).toContain("Hydraulikhammer");
    const danach = ansicht.findAll('input[type="checkbox"]');
    expect((danach[0]!.element as HTMLInputElement).checked).toBe(true);
    expect((danach[1]!.element as HTMLInputElement).checked).toBe(false);

    await ansicht.findAll("button").find((b) => b.text().includes("buchen"))?.trigger("click");
    await ansicht.vm.$nextTick();
    const [, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(koerper.geraet_ids).toEqual(["g1", "z1"]);
  });

  it("beugt die Mehrzahl", async () => {
    // In `SammelPanel` war genau das bei AP24 behoben worden — und die
    // wortgleiche Stelle hier blieb stehen.
    // Die Walze hat kein Zubehör — nur so kommt die Zählung auf genau eins.
    const { ansicht } = await baue(["g2"]);
    expect(ansicht.text()).toContain("1 Gerät buchen");
    expect(ansicht.text()).not.toContain("1 Geräte buchen");

    await ansicht.findAll("button").find((b) => b.text().includes("buchen"))?.trigger("click");
    await ansicht.vm.$nextTick();
    expect(ansicht.text()).toContain("1 Gerät gebucht");
    expect(ansicht.text()).not.toContain("1 Geräte gebucht");
  });

  it("holt bei einer Rücknahme keine Namensliste", async () => {
    // Dort gibt es kein Empfängerfeld. Die Bedingung stand vor AP25 schon da
    // und darf beim Zusammenführen nicht stillschweigend verschwinden.
    route.params.art = "ruecknahme";
    await baue();
    expect(api.get.mock.calls.map((c) => c[0])).not.toContain("/benutzer");
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
