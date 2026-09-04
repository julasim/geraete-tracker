/**
 * Die Ortsansicht in der Computer-Haltung (ab 1024 px).
 *
 * Am Handy ist das eine Liste mit aufklappbaren Orten, am Schreibtisch eine
 * zweispaltige Akte. Dieselben Daten, dieselben Aufrufe — hier festgehalten
 * wird, was beim Umbauen still kippen kann:
 *
 * * **Die Gruppierung darf die Sortierung nicht verdrehen.** Lager und
 *   Werkstatt zuerst, dann die Baustellen alphabetisch; so sucht man auch im
 *   Kopf. Überschriften zwischen den Zeilen sind genau die Gelegenheit, das
 *   zu verlieren.
 * * **Die Kennung eines Regalplatzes (`P-0001`) vergibt der Server.** Wird
 *   sie im Browser erzeugt oder fortgezählt, kleben irgendwann zwei Regale
 *   mit derselben Nummer — und der Nummernkreis der Regalplätze ist von dem
 *   der Geräte getrennt, bis hinunter in zwei CHECK-Constraints.
 * * **Stillgelegt wird mit Rückfrage, gelöscht wird nie.** An einem Ort hängt
 *   Buchungshistorie; wer stilllegt, während dort noch Geräte stehen, muss
 *   das vorher lesen. Ein DELETE gibt es in der API bewusst nicht.
 * * **Ohne `stammdaten.pflegen` erscheint kein Knopf**, der ohnehin nur 403
 *   liefern würde.
 *
 * jsdom wertet Medienabfragen nicht aus und meldet immer `false`. Die Haltung
 * wird deshalb direkt gesetzt (`breit.value = true`), so wie es
 * `composables/useBreite.ts` ausdrücklich vorsieht.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import OrteView from "@/views/OrteView.vue";
import { useBreite } from "@/composables/useBreite";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Lagerplatz, Standort } from "@/typen";

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

function ort(id: string, name: string, typ: Standort["typ"], adresse: string | null): Standort {
  return { id, name, typ, adresse, notiz: null, aktiv: true } as Standort;
}

function platz(id: string, bezeichnung: string, barcode: string | null): Lagerplatz {
  return {
    id,
    standort_id: "s-lager",
    bezeichnung,
    barcode,
    typ: "regal",
    notiz: null,
    aktiv: true,
  } as Lagerplatz;
}

function geraet(id: string, bezeichnung: string, lagerplatzId: string | null): Geraet {
  return {
    id,
    inventarnummer: id.replace("g", "100"),
    bezeichnung,
    status: "verfuegbar",
    aktueller_standort_id: "s-lager",
    aktueller_lagerplatz_id: lagerplatzId,
    schlagworte: [],
  } as unknown as Geraet;
}

// Absichtlich in verdrehter Reihenfolge abgelegt: Die Ansicht muss selbst
// sortieren, nicht die Datenquelle.
const ORTE = [
  ort("s-b2", "Wienerberg BA 3", "baustelle", "Gutheil-Schoder-Gasse, 1100 Wien"),
  ort("s-werk", "Werkstatt Guntramsdorf", "werkstatt", "Industriestraße 8"),
  ort("s-b1", "Donaufeld Bauteil B", "baustelle", "Anton-Sattler-Gasse 100, 1220 Wien"),
  ort("s-lager", "Bauhof Nord", "lager", "Nordstraße 42, 2100 Korneuburg"),
];

async function baueAnsicht(rechte: string[] = ["stammdaten.pflegen"]) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;

  const bestand = useBestand();
  bestand.standorte = [...ORTE];
  bestand.lagerplaetze = [platz("p1", "Regal A1", "P-0001"), platz("p2", "Regal C3", null)];
  bestand.geraete = [
    geraet("g1", "Rüttelplatte Wacker Neuson", "p1"),
    geraet("g2", "Trennschleifer Stihl TS 420", "p1"),
  ];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  const ansicht = mount(OrteView, {
    global: {
      stubs: {
        RouterLink: true,
        Kopf: true,
        Symbol: true,
        StatusChip: true,
        // Der Stub muss den Schlitz „rechts“ wirklich zeichnen — sonst wäre
        // der Knopf „Neue Baustelle“ unprüfbar.
        TopLeiste: { template: '<header><slot name="rechts" /></header>' },
      },
    },
  });
  await flushPromises();
  return { ansicht, bestand };
}

const zeilenTitel = (ansicht: Awaited<ReturnType<typeof baueAnsicht>>["ansicht"]) =>
  ansicht.findAll(".ort-zeile .pt-zeile__titel").map((n) => n.text());

const knopf = (ansicht: Awaited<ReturnType<typeof baueAnsicht>>["ansicht"], text: string) =>
  ansicht.findAll("button").find((b) => b.text() === text);

describe("Orte und Regale am Computer", () => {
  beforeEach(() => {
    // Die Haltung liegt auf Modulebene, nicht je Komponente — also vor
    // jedem Test frisch setzen.
    useBreite().breit.value = true;

    api.get.mockReset().mockResolvedValue({ geraete: [] });
    api.post.mockReset();
    api.patch.mockReset();
    api.delete.mockReset();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
  });

  afterEach(() => {
    useBreite().breit.value = false;
    vi.unstubAllGlobals();
  });

  it("gruppiert die Orte und behält dabei die Sortierung bei", async () => {
    const { ansicht } = await baueAnsicht();

    // „Extern“ fehlt, weil es keinen solchen Ort gibt — eine leere
    // Überschrift wäre eine Zeile, die nichts trägt.
    expect(ansicht.findAll(".ort-gruppe").map((n) => n.text())).toEqual([
      "Lager und Werkstatt",
      "Baustellen",
    ]);

    expect(zeilenTitel(ansicht)).toEqual([
      "Bauhof Nord",
      "Werkstatt Guntramsdorf",
      "Donaufeld Bauteil B",
      "Wienerberg BA 3",
    ]);
  });

  it("nennt die Art nur in der gemischten Gruppe", async () => {
    const { ansicht } = await baueAnsicht();
    const unter = ansicht.findAll(".ort-zeile .pt-zeile__unter").map((n) => n.text());

    // Lager und Werkstatt stehen zusammen — dort trägt die Art Information.
    expect(unter[0]).toBe("Lager · Nordstraße 42, 2100 Korneuburg");
    expect(unter[1]).toBe("Werkstatt · Industriestraße 8");
    // Unter der Überschrift „Baustellen“ wäre „Baustelle“ nur Papier.
    expect(unter[2]).toBe("Anton-Sattler-Gasse 100, 1220 Wien");
  });

  it("wählt den ersten Ort von selbst und holt seinen Bestand", async () => {
    api.get.mockResolvedValue({
      geraete: [geraet("g1", "Rüttelplatte Wacker Neuson", "p1")],
    });
    const { ansicht } = await baueAnsicht();

    expect(api.get).toHaveBeenCalledWith("/standorte/s-lager/bestand");
    expect(ansicht.find(".ort-kopf__name").text()).toBe("Bauhof Nord");
    expect(ansicht.find(".ort-kopf__zeile").text()).toBe(
      "Nordstraße 42, 2100 Korneuburg · 1 Gerät · 2 Regalplätze",
    );
  });

  it("wechselt auf Klick den Ort und lädt dessen Bestand nach", async () => {
    const { ansicht } = await baueAnsicht();
    api.get.mockClear();

    await ansicht.findAll(".ort-zeile")[2]?.trigger("click");
    await flushPromises();

    expect(api.get).toHaveBeenCalledWith("/standorte/s-b1/bestand");
    expect(ansicht.find(".ort-kopf__name").text()).toBe("Donaufeld Bauteil B");
    // Genau eine Zeile ist markiert — sonst weiß niemand, was rechts steht.
    const markiert = ansicht.findAll(".ort-zeile--gewaehlt");
    expect(markiert).toHaveLength(1);
    expect(markiert[0]?.text()).toContain("Donaufeld Bauteil B");
  });

  it("zeigt nur die Kennung, die der Server vergeben hat", async () => {
    const { ansicht } = await baueAnsicht();

    // Regal A1 hat eine Kennung vom Server, Regal C3 noch keine. Für C3 darf
    // hier NICHTS stehen, was nach einer Nummer aussieht — kein „P-0002“,
    // kein Fortzählen.
    expect(ansicht.findAll(".ort-platz__kennung").map((n) => n.text())).toEqual([
      "P-0001 · 2 Geräte",
      "0 Geräte",
    ]);
  });

  it("blendet ohne stammdaten.pflegen jeden Änderungsknopf aus", async () => {
    const ohne = await baueAnsicht([]);
    expect(ohne.ansicht.text()).not.toContain("Neue Baustelle");
    expect(ohne.ansicht.text()).not.toContain("Ort bearbeiten");
    expect(ohne.ansicht.text()).not.toContain("Regalplatz");

    const mit = await baueAnsicht();
    expect(knopf(mit.ansicht, "Neue Baustelle")).toBeDefined();
    expect(knopf(mit.ansicht, "Ort bearbeiten")).toBeDefined();
    expect(knopf(mit.ansicht, "Regalplatz")).toBeDefined();
  });

  it("fragt vor dem Stilllegen und nennt die noch stehenden Geräte", async () => {
    const { ansicht } = await baueAnsicht();
    await knopf(ansicht, "Ort bearbeiten")?.trigger("click");
    await knopf(ansicht, "Stilllegen")?.trigger("click");
    await flushPromises();

    const frage = String(vi.mocked(confirm).mock.calls[0]?.[0]);
    expect(frage).toContain("Hier stehen noch 2 Gerät(e)");
    expect(frage).toContain("Bauhof Nord");
    // Abgelehnt heißt abgelehnt: Es geht nichts hinaus.
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("legt still statt zu löschen und rückt die Auswahl nach", async () => {
    vi.mocked(confirm).mockReturnValue(true);
    api.patch.mockResolvedValue({ ...ORTE[3], aktiv: false });

    const { ansicht } = await baueAnsicht();
    await knopf(ansicht, "Ort bearbeiten")?.trigger("click");
    await knopf(ansicht, "Stilllegen")?.trigger("click");
    await flushPromises();

    expect(api.patch).toHaveBeenCalledWith("/standorte/s-lager", { aktiv: false });
    // Es gibt in der API bewusst kein DELETE — der Name steht in jeder
    // Buchung, die dorthin ging.
    expect(api.delete).not.toHaveBeenCalled();

    expect(zeilenTitel(ansicht)).not.toContain("Bauhof Nord");
    // Ohne Nachrücken stünde die rechte Hälfte auf einem Ort, den es nicht
    // mehr gibt.
    expect(ansicht.find(".ort-kopf__name").text()).toBe("Werkstatt Guntramsdorf");
  });

  it("überlässt die Kennung beim Anlegen eines Regalplatzes dem Server", async () => {
    api.post.mockResolvedValue(platz("p3", "Container Süd", "P-0012"));
    const { ansicht } = await baueAnsicht();

    await knopf(ansicht, "Regalplatz")?.trigger("click");
    await ansicht.find("#platz-name").setValue("Container Süd");
    await knopf(ansicht, "Anlegen")?.trigger("click");
    await flushPromises();

    // Weder `barcode` noch eine Nummer im Aufruf: Der Server vergibt sie.
    expect(api.post).toHaveBeenCalledWith("/lagerplaetze", {
      standort_id: "s-lager",
      bezeichnung: "Container Süd",
    });
    expect(ansicht.text()).toContain("P-0012");
  });
});
