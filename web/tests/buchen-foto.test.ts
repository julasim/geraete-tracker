/**
 * Das Zustandsfoto bei der Übergabe.
 *
 * Der Fall, für den es gebaut ist: Ein Gerät kommt beschädigt zurück, und
 * niemand kann belegen, wie es hinausging. Bei Fremdfirmen der klassische
 * Streitpunkt.
 *
 * Zwei Regeln, die hier festgehalten werden, weil sie leicht kippen:
 *
 * 1. **Das Foto geht NACH der Buchung hinaus** — es hängt an ihr, also muss
 *    sie zuerst existieren. Umgekehrt gäbe es ein Bild ohne Bezug.
 * 2. **Ein gescheiterter Upload darf die Buchung nicht umwerfen.** Der
 *    Bestand ist die Hauptsache, das Bild eine Beigabe. Wer im Funkloch
 *    steht, soll trotzdem gebucht haben.
 * 3. **Ohne `dateien.hochladen` gibt es das Feld gar nicht.** Sonst geht die
 *    Buchung durch und nur das Bild scheitert — mit einer Meldung, die den
 *    Grund nicht nennt. Der Benutzer hat dann im Regen umsonst fotografiert.
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
  useRoute: () => ({ params: { id: "g1", art: "ausgabe" }, query: {} }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

/** Die Bildverkleinerung reicht die Datei unverändert durch — hier irrelevant. */
vi.mock("@/composables/useFoto", () => ({
  useFoto: () => ({
    arbeitet: { value: false },
    fehler: { value: null },
    vorbereiten: vi.fn(async (roh: File) => ({
      datei: roh,
      vorschau: "blob:vorschau",
      vorher: 1000,
      nachher: 100,
    })),
  }),
}));

const geraet = {
  id: "g1",
  inventarnummer: "10001",
  bezeichnung: "Rüttelplatte",
  status: "verfuegbar",
  schlagworte: [],
} as unknown as Geraet;

function fetchAntwort(ok: boolean) {
  return vi.fn().mockResolvedValue({ ok, json: async () => ({}) });
}

async function baue(rechte = ["buchungen.erfassen", "stammdaten.pflegen", "dateien.hochladen"]) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;
  const bestand = useBestand();
  bestand.standorte = [
    { id: "s1", name: "Baustelle Nord", typ: "baustelle", aktiv: true } as Standort,
  ];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  api.get.mockImplementation(async (pfad: string) =>
    pfad.startsWith("/geraete/") ? geraet : [{ id: "b1", anzeigename: "Julius" }],
  );

  const ansicht = mount(BuchenView, {
    global: { stubs: { Kopf: true, Symbol: true, StatusChip: true, RouterLink: true } },
  });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return ansicht;
}

async function fotoWaehlen(ansicht: Awaited<ReturnType<typeof baue>>) {
  const feld = ansicht.find('input[type="file"]');
  const datei = new File(["x"], "zustand.jpg", { type: "image/jpeg" });
  Object.defineProperty(feld.element, "files", { value: [datei], configurable: true });
  await feld.trigger("change");
  await ansicht.vm.$nextTick();
}

describe("Zustandsfoto bei der Buchung", () => {
  beforeEach(() => {
    api.post.mockReset().mockResolvedValue({ geraet, buchung: { id: "buchung-1" } });
    vi.stubGlobal("fetch", fetchAntwort(true));
  });

  it("bietet die Aufnahme als freiwilligen Schritt an", async () => {
    const ansicht = await baue();
    expect(ansicht.text()).toContain("Zustand festhalten (freiwillig)");
    expect(ansicht.find('input[type="file"]').exists()).toBe(true);
  });

  it("zeigt das Feld ohne dateien.hochladen gar nicht erst", async () => {
    const ansicht = await baue(["buchungen.erfassen"]);
    expect(ansicht.text()).not.toContain("Zustand festhalten (freiwillig)");
    expect(ansicht.find('input[type="file"]').exists()).toBe(false);
    // Und der Hauptweg bleibt bedienbar: Das Feld war freiwillig.
    expect(ansicht.findAll("button").some((b) => b.text() === "Ausgeben")).toBe(true);
  });

  it("bucht ohne Foto, ohne etwas hochzuladen", async () => {
    const ansicht = await baue();
    await ansicht.findAll("button").find((b) => b.text() === "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lädt das Foto NACH der Buchung hoch, mit deren Kennung", async () => {
    const ansicht = await baue();
    await fotoWaehlen(ansicht);
    await ansicht.findAll("button").find((b) => b.text() === "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(fetch).toHaveBeenCalledOnce();
    const aufrufe = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [pfad, aufruf] = aufrufe[0] as [string, RequestInit];
    expect(pfad).toBe("/api/geraete/g1/dateien");
    // Die Kennung der eben angelegten Buchung muss mitgehen — sonst hinge
    // das Bild am Gerät statt am Vorgang.
    expect((aufruf.body as FormData).get("buchung_id")).toBe("buchung-1");
    expect((aufruf.body as FormData).get("datei")).toBeInstanceOf(File);
  });

  it("lässt die Buchung stehen, wenn das Hochladen scheitert", async () => {
    vi.stubGlobal("fetch", fetchAntwort(false));
    const ansicht = await baue();
    await fotoWaehlen(ansicht);
    await ansicht.findAll("button").find((b) => b.text() === "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    // Die Buchung ist erfolgt …
    expect(api.post).toHaveBeenCalledOnce();
    // … und der Benutzer erfährt genau das, statt einen Abbruch zu sehen.
    expect(ansicht.text()).toContain("Die Buchung ist gespeichert");
  });
});
