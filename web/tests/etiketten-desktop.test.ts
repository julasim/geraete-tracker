/**
 * Der Etikettendruck am Computer.
 *
 * Hier hängt echtes Geld an vier Regeln, und alle vier lassen sich beim
 * Umbauen der Oberfläche verlieren, ohne dass eine Typprüfung anschlägt:
 *
 * 1. **Der Skalierungshinweis steht ganz oben.** Rutscht er unter die
 *    Tabelle, liest ihn nur noch, wer schon ausgewählt hat — und ein vom
 *    Drucker verkleinerter Barcode fällt erst auf, wenn 200 Etiketten
 *    kleben.
 * 2. **Kein automatischer Druckdialog.** Das PDF geht in ein neues Fenster,
 *    den Druck löst der Mensch aus. Wer ungefragt druckt, verbraucht
 *    Nummern.
 * 3. **Zwei getrennte Nummernkreise.** Geräte (Ziffern) und Regalplätze
 *    (P-…) sind bis hinunter in zwei CHECK-Constraints getrennt. Ein
 *    gemeinsamer Druckvorgang wäre die erste Stelle, an der sie wieder
 *    zusammenliefen.
 * 4. **Nummern sind ab dem Druck verbraucht.** Deshalb die Rückfrage, der
 *    sichtbare Bereich davor — und deshalb schickt das Frontend niemals
 *    eine Nummer mit: vergeben wird ausschließlich im Server.
 *
 * jsdom wertet Medienabfragen nicht aus und meldet immer `false`. Die
 * Haltung wird deshalb direkt gesetzt (`breit.value = true`), wie in
 * `composables/useBreite.ts` beschrieben.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import EtikettenView from "@/views/EtikettenView.vue";
import { useBreite } from "@/composables/useBreite";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Lagerplatz } from "@/typen";

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

// TopLeiste greift auf den Router zu; die Ansicht selbst nicht.
vi.mock("vue-router", () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ params: {}, query: {} }),
}));

const { breit, tablet } = useBreite();

function geraet(id: string, nummer: string, bezeichnung: string): Geraet {
  return {
    id,
    inventarnummer: nummer,
    bezeichnung,
    status: "verfuegbar",
    standort: "Bauhof Nord",
    schlagworte: [],
  } as unknown as Geraet;
}

const geraete = [
  geraet("g1", "10070", "Tauchpumpe Tsurumi LB-480"),
  geraet("g2", "10071", "Stampfer Wacker Neuson BS 60-4s"),
  geraet("g3", "10072", "Kernbohrgerät Hilti DD 150-U"),
];

const regal: Lagerplatz = {
  id: "p1",
  standort_id: "s1",
  bezeichnung: "Regal A1",
  barcode: "P-0001",
  typ: "regal",
  notiz: null,
  aktiv: true,
};

/** Was `fetch` zuletzt bekommen hat — Pfad, Methode, gelesener Körper. */
interface Aufruf {
  pfad: string;
  methode: string;
  koerper: Record<string, unknown>;
}

let aufrufe: Aufruf[] = [];
let geoeffnet: [string, string][] = [];

function fetchStellen(): void {
  aufrufe = [];
  globalThis.fetch = vi.fn(async (pfad: unknown, init: unknown) => {
    const opt = (init ?? {}) as { method?: string; body?: string };
    aufrufe.push({
      pfad: String(pfad),
      methode: opt.method ?? "GET",
      koerper: JSON.parse(opt.body ?? "{}") as Record<string, unknown>,
    });
    return {
      ok: true,
      headers: new Headers({ "X-Nummern-Von": "10205", "X-Nummern-Bis": "10228" }),
      blob: async () => new Blob(["%PDF"], { type: "application/pdf" }),
      json: async () => ({}),
    };
  }) as unknown as typeof fetch;
}

async function baue(haltung: { breit: boolean; tablet?: boolean } = { breit: true }) {
  setActivePinia(createPinia());
  breit.value = haltung.breit;
  tablet.value = haltung.tablet ?? false;

  const bestand = useBestand();
  bestand.geraete = geraete;
  bestand.lagerplaetze = [regal];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  api.get.mockImplementation(async (pfad: string) => {
    if (pfad === "/etiketten/formate") {
      return {
        formate: [{ schluessel: "70x37", name: "70 × 37 mm (24 je Bogen)", proBogen: 24 }],
        voreinstellung: "70x37",
        firmenname: "SIMA INFRA Construction GmbH",
      };
    }
    if (pfad === "/etiketten/nummern") {
      return { vergeben: 204, reserviert: 24, gesehen: 3, hoechste: "10204", offen: [] };
    }
    return null;
  });

  const ansicht = mount(EtikettenView, { global: { stubs: { Kopf: true } } });
  // Zwei Runden: onMounted wartet auf laden(), dann auf zwei API-Aufrufe.
  await new Promise((f) => setTimeout(f, 0));
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

/** Den Knopf finden, dessen Beschriftung diesen Text enthält. */
function knopf(ansicht: ReturnType<typeof mount>, text: string) {
  const treffer = ansicht.findAll("button").find((b) => b.text().includes(text));
  if (!treffer) throw new Error(`Kein Knopf mit „${text}" gefunden`);
  return treffer;
}

describe("Etiketten drucken am Computer", () => {
  beforeEach(() => {
    api.get.mockReset();
    fetchStellen();
    geoeffnet = [];
    window.open = vi.fn((url: unknown, ziel: unknown) => {
      geoeffnet.push([String(url), String(ziel)]);
      return null;
    }) as unknown as typeof window.open;
    window.print = vi.fn();
    URL.createObjectURL = vi.fn(() => "blob:etiketten");
    window.confirm = vi.fn(() => true);
  });

  afterEach(() => {
    // Die Haltung liegt auf Modulebene und gilt sonst für die nächste Datei.
    breit.value = false;
    tablet.value = false;
  });

  it("stellt den Skalierungshinweis an den Anfang, nicht ans Ende", async () => {
    const { ansicht } = await baue();

    const erstes = ansicht.find(".et-spalte").element.firstElementChild;
    expect(erstes?.className).toContain("pt-meldung--warnung");
    expect(erstes?.textContent).toContain("Skalierung auf 100 %");
  });

  it("öffnet das PDF in einem neuen Fenster und druckt NICHT von selbst", async () => {
    const { ansicht } = await baue();

    await knopf(ansicht, "Alle 3").trigger("click");
    await knopf(ansicht, "PDF öffnen").trigger("click");
    await ansicht.vm.$nextTick();

    const gerufen = aufrufe.find((a) => a.pfad === "/api/etiketten");
    expect(gerufen?.methode).toBe("POST");
    expect(gerufen?.koerper.geraete).toEqual(["g1", "g2", "g3"]);

    expect(geoeffnet).toEqual([["blob:etiketten", "_blank"]]);
    expect(window.print).not.toHaveBeenCalled();
  });

  it("hält die zwei Nummernkreise auseinander — eigener Bogen, eigener Knopf", async () => {
    const { ansicht } = await baue();

    await knopf(ansicht, "Alle 3").trigger("click");
    await knopf(ansicht, "Regal A1").trigger("click");
    await ansicht.vm.$nextTick();

    await knopf(ansicht, "Regal-Etikett").trigger("click");
    await ansicht.vm.$nextTick();

    const regale = aufrufe.find((a) => a.pfad === "/api/etiketten/lagerplaetze");
    expect(regale?.methode).toBe("POST");
    expect(regale?.koerper.lagerplaetze).toEqual(["p1"]);
    // Kein Gerät auf dem Regalbogen, auch wenn drei ausgewählt sind.
    expect(regale?.koerper.geraete).toBeUndefined();

    await knopf(ansicht, "PDF öffnen").trigger("click");
    await ansicht.vm.$nextTick();

    const geraeteBogen = aufrufe.find((a) => a.pfad === "/api/etiketten");
    expect(geraeteBogen?.koerper.lagerplaetze).toBeUndefined();
  });

  it("zeigt den Bereich, den der Vorratsdruck verbraucht, VOR dem Auslösen", async () => {
    const { ansicht } = await baue();

    // Nächste freie Nummer 10205 (höchste 10204), 24 Stück → bis 10228.
    const text = ansicht.text();
    expect(text).toContain("10205");
    expect(text).toContain("10228");
    // Noch nichts ausgelöst — die Zahlen stehen da, bevor jemand klickt.
    expect(aufrufe).toEqual([]);
  });

  it("löst den Vorratsdruck ohne Bestätigung nicht aus", async () => {
    const { ansicht } = await baue();
    window.confirm = vi.fn(() => false);

    await knopf(ansicht, "Etiketten drucken").trigger("click");
    await ansicht.vm.$nextTick();

    expect(window.confirm).toHaveBeenCalled();
    expect(aufrufe.find((a) => a.pfad === "/api/etiketten/vorrat")).toBeUndefined();
  });

  it("schickt beim Vorratsdruck keine selbst gezählte Nummer mit", async () => {
    const { ansicht } = await baue();

    await knopf(ansicht, "Etiketten drucken").trigger("click");
    await ansicht.vm.$nextTick();

    const vorrat = aufrufe.find((a) => a.pfad === "/api/etiketten/vorrat");
    expect(vorrat?.methode).toBe("POST");
    // Nur eine Anzahl und die Bogenangaben. Welche Nummern es werden,
    // entscheidet allein der Server.
    expect(Object.keys(vorrat?.koerper ?? {}).sort()).toEqual([
      "anzahl",
      "format",
      "startPosition",
    ]);
    expect(vorrat?.koerper.anzahl).toBe(24);
  });

  it("zählt Auswahl und Bögen in der Fußzeile mit", async () => {
    const { ansicht } = await baue();

    expect(ansicht.find(".et-fuss__text").text()).toContain("0 Etiketten");

    await knopf(ansicht, "Alle 3").trigger("click");
    await ansicht.vm.$nextTick();
    const fuss = ansicht.find(".et-fuss__text").text();
    expect(fuss).toContain("3 Etiketten");
    expect(fuss).toContain("1 Bogen");
    expect(fuss).toContain("Start bei Position 0");

    await knopf(ansicht, "Keine").trigger("click");
    await ansicht.vm.$nextTick();
    expect(ansicht.find(".et-fuss__text").text()).toContain("0 Etiketten");
  });

  it("wählt nur aus, was die Suche übrig lässt", async () => {
    const { ansicht } = await baue();

    await ansicht.find('input[type="search"]').setValue("10071");
    await ansicht.vm.$nextTick();

    await knopf(ansicht, "Alle 1").trigger("click");
    await knopf(ansicht, "PDF öffnen").trigger("click");
    await ansicht.vm.$nextTick();

    expect(aufrufe.find((a) => a.pfad === "/api/etiketten")?.koerper.geraete).toEqual(["g2"]);
  });

  it("lässt die Handy-Haltung unberührt", async () => {
    const { ansicht } = await baue({ breit: false });

    expect(ansicht.find(".et-pult").exists()).toBe(false);
    expect(ansicht.find("kopf-stub").exists()).toBe(true);

    // Die feste Fußleiste erscheint erst, wenn etwas ausgewählt ist.
    expect(ansicht.find(".fussleiste").exists()).toBe(false);
    await knopf(ansicht, "Alle 3").trigger("click");
    await ansicht.vm.$nextTick();
    expect(ansicht.find(".fussleiste").exists()).toBe(true);
  });
});
