/**
 * Zwei Knöpfe, die für die mitgelieferten Rollen im Alltag ins Leere liefen.
 *
 * * **„Paket ausgeben"** (`PaketeView`) stand ohne jede Prüfung da, im
 *   Gegensatz zu „Paket löschen" direkt daneben. Der Knopf füllt vorher die
 *   Sammlung und führt nach `/sammeln/ausgabe` — ohne `buchungen.erfassen`
 *   landet der Benutzer also mit einer unerklärlich befüllten Auswahl in der
 *   Geräteliste, ohne jede Meldung.
 * * **„Ausmustern"** (`GeraetBearbeitenView`) verlangt `geraete.ausmustern`,
 *   die Ansicht selbst nur `geraete.pflegen`. Das trifft die Rolle „Lager
 *   und Werkstatt" im Normalbetrieb: Sie bestätigt „Gerät ausmustern?", und
 *   dann passiert nichts.
 *
 * Beide Male ist es kein Loch — der Server weist ab. Aber ein Knopf, der für
 * diesen Benutzer nie funktioniert, gehört nicht dorthin.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import PaketeView from "@/views/PaketeView.vue";
import GeraetBearbeitenView from "@/views/GeraetBearbeitenView.vue";
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
  useRoute: () => ({ params: { id: "g1" }, query: {} }),
  useRouter: () => ({ push: geschoben }),
}));

const STUBS = { Kopf: true, StatusChip: true, Symbol: true, RouterLink: true };

const geraet = {
  id: "g1",
  inventarnummer: "10014",
  bezeichnung: "Rüttelplatte",
  status: "verfuegbar",
  rev: 3,
  hersteller: null,
  modell: null,
  seriennummer: null,
  notiz: null,
  betriebsstunden: null,
  gehoert_zu_id: null,
  schlagworte: [],
  zubehoer: [],
} as unknown as Geraet;

function knopftexte(ansicht: { findAll: (s: string) => { text: () => string }[] }): string[] {
  return ansicht
    .findAll("button")
    .map((k) => k.text().trim())
    .filter(Boolean);
}

// ── Pakete ─────────────────────────────────────────────────────────────────

async function bauePakete(rechte: string[]) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;
  const bestand = useBestand();
  bestand.laden = vi.fn().mockResolvedValue(undefined);
  bestand.geraete = [geraet];

  api.get.mockImplementation(async (pfad: string) => {
    if (pfad === "/pakete") return [{ id: "p1", name: "Estrich komplett", anzahl: 1 }];
    if (pfad.endsWith("/geraete")) return [{ ...geraet }];
    return [];
  });

  const ansicht = mount(PaketeView, { global: { stubs: STUBS } });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();

  // Aufklappen — die beiden Knöpfe stehen im aufgeklappten Paket.
  const zeile = ansicht.findAll("button").find((k) => k.text().includes("Estrich komplett"));
  await zeile!.trigger("click");
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return ansicht;
}

describe("Pakete: „Paket ausgeben“", () => {
  beforeEach(() => {
    geschoben.mockReset();
    api.get.mockReset();
  });

  it("erscheint mit buchungen.erfassen", async () => {
    const ansicht = await bauePakete(["buchungen.erfassen"]);
    expect(knopftexte(ansicht)).toContain("Paket ausgeben");
  });

  it("bleibt ohne buchungen.erfassen weg", async () => {
    const ansicht = await bauePakete(["stammdaten.pflegen"]);
    const texte = knopftexte(ansicht);
    expect(texte).not.toContain("Paket ausgeben");
    // Der Rest der Ansicht bleibt bedienbar: Inhalt sehen, pflegen, löschen.
    expect(texte).toContain("Paket löschen");
    expect(ansicht.text()).toContain("Rüttelplatte");
  });

  it("füllt die Sammlung und führt nach /sammeln/ausgabe", async () => {
    const ansicht = await bauePakete(["buchungen.erfassen"]);
    const knopf = ansicht.findAll("button").find((k) => k.text().trim() === "Paket ausgeben");
    await knopf!.trigger("click");
    expect(useBestand().sammlung).toEqual(["g1"]);
    expect(geschoben).toHaveBeenCalledWith("/sammeln/ausgabe");
  });
});

// ── Gerät bearbeiten ───────────────────────────────────────────────────────

async function baueBearbeiten(rechte: string[]) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;
  const bestand = useBestand();
  bestand.laden = vi.fn().mockResolvedValue(undefined);
  bestand.geraete = [geraet];
  bestand.schlagworte = [];

  api.get.mockImplementation(async (pfad: string) => {
    if (pfad.endsWith("/barcodes")) return [{ barcode: "10014", aktiv: true }];
    return geraet;
  });

  const ansicht = mount(GeraetBearbeitenView, { global: { stubs: STUBS } });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return ansicht;
}

describe("Gerät bearbeiten: „Ausmustern“", () => {
  beforeEach(() => {
    geschoben.mockReset();
    api.get.mockReset();
    api.post.mockReset();
  });

  it("erscheint mit geraete.ausmustern", async () => {
    const ansicht = await baueBearbeiten(["geraete.pflegen", "geraete.ausmustern"]);
    expect(knopftexte(ansicht)).toContain("Ausmustern");
    expect(ansicht.text()).toContain("Aus dem Bestand nehmen");
  });

  it("bleibt für „Lager und Werkstatt“ weg — die hat nur geraete.pflegen", async () => {
    const ansicht = await baueBearbeiten([
      "buchungen.erfassen",
      "schaeden.melden",
      "dateien.hochladen",
      "geraete.pflegen",
      "stammdaten.pflegen",
      "pruefungen.eintragen",
      "schaeden.bearbeiten",
      "dateien.verwalten",
      "etiketten.drucken",
    ]);
    const texte = knopftexte(ansicht);
    expect(texte).not.toContain("Ausmustern");
    expect(ansicht.text()).not.toContain("Aus dem Bestand nehmen");
    // Wofür sie hier ist, bleibt: Stammdaten und Etiketten.
    expect(texte).toContain("Speichern");
    expect(texte).toContain("Stilllegen");
  });
});
