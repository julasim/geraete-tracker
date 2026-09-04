/**
 * Die Kartenliste und die eingeklappte Suche — die beiden Bauteile, die am
 * iPad quer an die Stelle der Tabelle und des offenen Suchfelds treten.
 *
 * Festgehalten wird hier, was beim Umbauen leicht kippt:
 *
 * 1. **Der Tipp aufs Kästchen darf das Detail nicht öffnen.** Sonst ist die
 *    Sammelausgabe am iPad unbenutzbar: Jeder Versuch auszuwählen führte
 *    stattdessen auf die Detailseite.
 * 2. **Leere Werte fallen aus der Unterzeile weg**, statt als „—" Platz zu
 *    belegen — und dabei darf kein doppelter Trenner stehenbleiben.
 * 3. **Escape leert die Suche nicht.** Wer sucht und danebengreift, will
 *    seine Eingabe nicht verlieren.
 * 4. **Eine zugeklappte Suche mit Text sagt, wonach sie sucht.** Sonst steht
 *    eine gefilterte Liste da, ohne dass irgendwo zu sehen ist, warum — und
 *    genau dann meldet jemand, es fehlten Geräte.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import GeraeteKarten from "@/components/GeraeteKarten.vue";
import SuchKnopf from "@/components/SuchKnopf.vue";
import type { Geraet } from "@/typen";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock("@/api", () => ({
  api,
  ApiError: class ApiError extends Error {},
}));

function geraet(teile: Partial<Geraet> & { id: string; bezeichnung: string }): Geraet {
  return {
    inventarnummer: null,
    status: "verfuegbar",
    standort: null,
    lagerplatz: null,
    nutzer: null,
    schlagworte: [],
    ...teile,
  } as unknown as Geraet;
}

/** Draußen, seit 21 Tagen, nicht überzogen. */
const verdichter = geraet({
  id: "g1",
  bezeichnung: "Verdichter Weber MT CR 3",
  inventarnummer: "10004",
  status: "ausgegeben",
  standort: "Donaufeld Bauteil B",
  nutzer: "T. Krenn",
});

/** Im Lager: Person leer, dafür ein Regalplatz. */
const ruettelplatte = geraet({
  id: "g2",
  bezeichnung: "Rüttelplatte Wacker Neuson DPU 6555",
  inventarnummer: "10014",
  standort: "Bauhof Nord",
  lagerplatz: "Regal C3",
});

/** Noch ohne Etikett und ohne Ort — beide Angaben fehlen. */
const nackt = geraet({ id: "g3", bezeichnung: "Kabeltrommel 50 m" });

/**
 * Erfasst, aber noch nicht etikettiert: kein Nummernfeld, dafür ein Ort.
 * Der Fall entsteht bei jeder Ersterfassung — und er ist der einzige, an dem
 * sich zeigt, ob der Trenner am Zeilenanfang wegbleibt.
 */
const ohneEtikett = geraet({
  id: "g4",
  bezeichnung: "Stromerzeuger Endress ESE 606",
  standort: "Bauhof Nord",
});

async function karten(eigenschaften: {
  geraete?: Geraet[];
  auswahl?: string[];
  waehlbar?: boolean;
}) {
  const ansicht = mount(GeraeteKarten, {
    props: {
      geraete: eigenschaften.geraete ?? [verdichter, ruettelplatte, nackt],
      auswahl: eigenschaften.auswahl ?? [],
      waehlbar: eigenschaften.waehlbar ?? false,
    },
  });
  // Die offenen Ausgaben kommen erst nach dem Einhängen herein.
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return ansicht;
}

describe("Kartenliste am iPad", () => {
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue([
      { geraet_id: "g1", tage: 21, ueberfaellig: false },
    ]);
  });

  it("stellt alle Angaben in die Unterzeile", async () => {
    const ansicht = await karten({ geraete: [verdichter] });
    const unter = ansicht.get(".pt-zeile__unter").text();

    expect(unter).toBe("10004 · Donaufeld Bauteil B · T. Krenn · seit 21 Tagen");
  });

  it("nimmt den Regalplatz, wenn niemand das Gerät hat", async () => {
    const ansicht = await karten({ geraete: [ruettelplatte] });

    expect(ansicht.get(".pt-zeile__unter").text()).toBe("10014 · Bauhof Nord · Regal C3");
  });

  it("lässt leere Werte weg, statt einen Strich zu setzen", async () => {
    const ansicht = await karten({ geraete: [nackt] });
    const unter = ansicht.get(".pt-zeile__unter").text();

    // Weder ein „—" noch ein übriggebliebener Trenner.
    expect(unter).toBe("");
    expect(ansicht.text()).not.toContain("—");
  });

  it("beginnt die Unterzeile ohne Trenner, wenn die Nummer fehlt", async () => {
    const ansicht = await karten({ geraete: [ohneEtikett] });

    // Nicht „ · Bauhof Nord": Ein Trenner am Zeilenanfang sieht wie ein
    // verlorener Wert aus, obwohl nur noch kein Etikett geklebt ist.
    expect(ansicht.get(".pt-zeile__unter").text()).toBe("Bauhof Nord");
  });

  it("setzt auch vor die Dauer nur dann einen Trenner, wenn etwas davorsteht", async () => {
    api.get.mockResolvedValue([{ geraet_id: "g3", tage: 5, ueberfaellig: false }]);
    const ansicht = await karten({ geraete: [nackt] });

    expect(ansicht.get(".pt-zeile__unter").text()).toBe("seit 5 Tagen");
  });

  it("färbt eine überzogene Rückgabe", async () => {
    api.get.mockResolvedValue([{ geraet_id: "g1", tage: 63, ueberfaellig: true }]);
    const ansicht = await karten({ geraete: [verdichter] });

    expect(ansicht.get(".geraetekarten__spaet").text()).toContain("seit 63 Tagen");
  });

  it("zeigt die Liste weiter, wenn die offenen Ausgaben nicht kommen", async () => {
    // Antwortet die Route nicht, fehlt die Dauer — die Liste steht trotzdem.
    api.get.mockRejectedValue(new Error("503"));
    const ansicht = await karten({ geraete: [verdichter] });

    expect(ansicht.get(".pt-zeile__unter").text()).toBe("10004 · Donaufeld Bauteil B · T. Krenn");
  });

  it("öffnet beim Tipp auf die Zeile das Detail", async () => {
    const ansicht = await karten({ geraete: [verdichter], waehlbar: true });
    await ansicht.get("button.pt-zeile").trigger("click");

    expect(ansicht.emitted("oeffnen")).toEqual([["g1"]]);
  });

  it("öffnet beim Tipp aufs Kästchen NICHT das Detail", async () => {
    const ansicht = await karten({ geraete: [verdichter], waehlbar: true });
    const kaestchen = ansicht.findAll('.geraetekarten__reihe input[type="checkbox"]');
    await kaestchen[0]!.trigger("click");

    expect(ansicht.emitted("umschalten")).toEqual([["g1"]]);
    expect(ansicht.emitted("oeffnen")).toBeUndefined();
  });

  it("lässt den Haken von der Auswahl regieren, nicht vom Browser", async () => {
    const ansicht = await karten({ geraete: [verdichter], waehlbar: true });
    const kaestchen = ansicht.findAll('.geraetekarten__reihe input[type="checkbox"]');
    await kaestchen[0]!.trigger("click");

    // Der Aufrufer hat `auswahl` (noch) nicht geändert — dann darf auch kein
    // Haken dastehen. Sonst zeigte die Liste eine Auswahl, die es nicht gibt.
    expect((kaestchen[0]!.element as HTMLInputElement).checked).toBe(false);
  });

  it("zeigt ohne das Recht kein Kästchen", async () => {
    const ansicht = await karten({ waehlbar: false });

    expect(ansicht.findAll('input[type="checkbox"]')).toHaveLength(0);
  });

  it("wählt über den Kopf alle sichtbaren aus", async () => {
    const ansicht = await karten({ waehlbar: true });
    await ansicht.get(".geraetekarten__kopf input").trigger("click");

    expect(ansicht.emitted("alle")).toEqual([[["g1", "g2", "g3"]]]);
  });

  it("hebt die Auswahl auf, wenn schon alles gewählt ist", async () => {
    const ansicht = await karten({ waehlbar: true, auswahl: ["g1", "g2", "g3"] });
    await ansicht.get(".geraetekarten__kopf input").trigger("click");

    expect(ansicht.emitted("keine")).toEqual([[]]);
    expect(ansicht.emitted("alle")).toBeUndefined();
  });

  it("zeigt eine Teilauswahl als Teilauswahl", async () => {
    const ansicht = await karten({ waehlbar: true, auswahl: ["g1"] });
    const kopf = ansicht.get(".geraetekarten__kopf input").element as HTMLInputElement;

    expect(kopf.checked).toBe(false);
    expect(kopf.indeterminate).toBe(true);
  });

  it("hebt die ausgewählte Zeile hervor", async () => {
    const ansicht = await karten({ waehlbar: true, auswahl: ["g2"] });
    const reihen = ansicht.findAll(".geraetekarten__reihe");

    expect(reihen[0]!.classes()).not.toContain("geraetekarten__reihe--gewaehlt");
    expect(reihen[1]!.classes()).toContain("geraetekarten__reihe--gewaehlt");
  });

  it("sagt es, wenn nichts passt", async () => {
    const ansicht = await karten({ geraete: [] });

    expect(ansicht.get(".pt-leer").text()).toBe("Kein Gerät passt zur Suche.");
  });
});

describe("Suche als Knopf", () => {
  it("zeigt zugeklappt einen Knopf und kein Feld", () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "" } });

    expect(ansicht.get("button").text()).toBe("Suchen");
    expect(ansicht.find("input").exists()).toBe(false);
  });

  it("blendet das Feld ein und setzt den Fokus hinein", async () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "" }, attachTo: document.body });
    await ansicht.get("button").trigger("click");
    await ansicht.vm.$nextTick();

    const feld = ansicht.get("input").element;
    expect(document.activeElement).toBe(feld);
    ansicht.unmount();
  });

  it("schließt bei Escape, ohne die Eingabe zu leeren", async () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "rüttel" } });
    // Mit Text startet die Suche aufgeklappt.
    expect(ansicht.find("input").exists()).toBe(true);

    await ansicht.get("input").trigger("keydown", { key: "Escape" });
    await ansicht.vm.$nextTick();

    expect(ansicht.find("input").exists()).toBe(false);
    // Kein update:modelValue — der Text bleibt unangetastet.
    expect(ansicht.emitted("update:modelValue")).toBeUndefined();
  });

  it("trägt den Suchtext auf dem Knopf, wenn sie zugeklappt ist", async () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "rüttel" } });
    await ansicht.get("input").trigger("keydown", { key: "Escape" });
    await ansicht.vm.$nextTick();

    // Ohne das stünde eine gefilterte Liste da, ohne sichtbaren Grund.
    expect(ansicht.get("button").text()).toBe("rüttel");
  });

  it("klappt beim Verlassen zu, solange nichts eingetippt ist", async () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "" } });
    await ansicht.get("button").trigger("click");
    await ansicht.get("input").trigger("blur");

    expect(ansicht.find("input").exists()).toBe(false);
  });

  it("bleibt beim Verlassen offen, wenn etwas drinsteht", async () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "10014" } });
    await ansicht.get("input").trigger("blur");

    expect(ansicht.find("input").exists()).toBe(true);
  });

  it("reicht die Eingabe nach oben durch", async () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "" } });
    await ansicht.get("button").trigger("click");
    await ansicht.get("input").setValue("10014");

    expect(ansicht.emitted("update:modelValue")).toEqual([["10014"]]);
  });

  it("übernimmt den eigenen Platzhalter", async () => {
    const ansicht = mount(SuchKnopf, { props: { modelValue: "", platzhalter: "Nummer …" } });
    await ansicht.get("button").trigger("click");

    expect(ansicht.get("input").attributes("placeholder")).toBe("Nummer …");
  });
});
