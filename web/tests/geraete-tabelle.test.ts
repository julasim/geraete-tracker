/**
 * Die Geräteliste am Computer — Tabelle und Sammelausgabe.
 *
 * Geprüft wird ausschließlich das, was am Schreibtisch NEU ist. Die
 * Kartenliste des Handys bleibt unverändert und hat ihre eigenen Regeln.
 *
 * Sechs Behauptungen, die leicht kippen und die man im Browser nur sieht, wenn
 * man genau hinschaut:
 *
 * 1. **Die Zeile führt aufs Detail, das Kästchen nicht.** Fällt der
 *    Klick-Stopper am Kästchen weg, öffnet jeder Haken zugleich die
 *    Gerätekarte — und die Mehrfachauswahl ist unbenutzbar.
 * 2. **Das Kopfkästchen meint die sichtbaren Zeilen**, in der Reihenfolge, in
 *    der sie dastehen. Wer nach einem Ort filtert und oben anhakt, will die
 *    gefilterten Geräte, nicht alle 204.
 * 3. **Leere Werte stehen beim Sortieren immer unten**, in beide Richtungen.
 * 4. **Ohne `buchungen.erfassen` gibt es keine Auswahl.**
 * 5. **Die Fehlermeldung des Servers nimmt das genannte Gerät aus der
 *    Auswahl.** Sonst scheitert der nächste Versuch an derselben Stelle.
 * 6. **Die Auswahl liegt in `bestand.sammlung`** — derselben Sammlung, die am
 *    Handy der Scanner füllt. Zwei Auswahlen hießen zwei Wege in eine Buchung.
 *
 * Jede dieser Regeln ist gegengeprüft: ausgebaut, Test rot, wieder eingebaut.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import GeraeteKarten from "@/components/GeraeteKarten.vue";
import GeraeteTabelle from "@/components/GeraeteTabelle.vue";
import SammelPanel from "@/components/SammelPanel.vue";
import SuchKnopf from "@/components/SuchKnopf.vue";
import GeraeteView from "@/views/GeraeteView.vue";
import { useBreite } from "@/composables/useBreite";
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

const gedrueckt = vi.fn();
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: {}, query: {} }),
  useRouter: () => ({ push: gedrueckt }),
}));

function geraet(teil: Partial<Geraet> & { id: string; bezeichnung: string }): Geraet {
  return {
    inventarnummer: null,
    status: "verfuegbar",
    standort: null,
    lagerplatz: null,
    nutzer: null,
    schlagworte: [],
    aktueller_standort_id: null,
    ...teil,
  } as unknown as Geraet;
}

const walze = geraet({
  id: "g1",
  bezeichnung: "Walze Bomag",
  inventarnummer: "10008",
  status: "ausgegeben",
  standort: "Wienerberg",
  nutzer: "M. Wallner",
});
const ruettler = geraet({
  id: "g2",
  bezeichnung: "Rüttelplatte Wacker",
  inventarnummer: "10014",
  standort: "Bauhof Nord",
  lagerplatz: "Regal C3",
});
const pumpe = geraet({
  id: "g3",
  bezeichnung: "Tauchpumpe Tsurumi",
  inventarnummer: "10070",
  standort: null,
});

/** Nur die Datenzeilen — die Kopfzeile trägt dieselbe Blockklasse. */
function zeilen(ansicht: ReturnType<typeof mount>) {
  return ansicht.findAll('[role="row"]:not(.tafel__zeile--kopf)');
}

function baueTabelle(werte: Partial<InstanceType<typeof GeraeteTabelle>["$props"]> = {}) {
  api.get.mockResolvedValue([]);
  return mount(GeraeteTabelle, {
    props: { geraete: [walze, ruettler, pumpe], auswahl: [], waehlbar: true, ...werte },
    global: { stubs: { StatusChip: true, Symbol: true } },
  });
}

describe("Geräte-Tabelle", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    api.get.mockReset();
    api.post.mockReset();
    gedrueckt.mockReset();
  });

  /*
   * Nur die Reihenfolge wird behauptet, nicht die Art des Vergleichs: Solange
   * alle Etikettennummern fünfstellig sind, liefern Zahl- und Textvergleich
   * dasselbe Ergebnis. Der Zahlvergleich im Code steht trotzdem dort — für
   * den Tag, an dem eine sechsstellige Nummer dazukommt.
   */
  it("sortiert nach Nummer aufsteigend und dreht beim zweiten Klick um", async () => {
    const ansicht = baueTabelle();
    await ansicht.vm.$nextTick();

    expect(zeilen(ansicht).map((z) => z.text())).toEqual([
      expect.stringContaining("10008"),
      expect.stringContaining("10014"),
      expect.stringContaining("10070"),
    ]);

    const nummernkopf = ansicht.findAll("button.kopfknopf")[0]!;
    await nummernkopf.trigger("click");
    expect(zeilen(ansicht)[0]!.text()).toContain("10070");
  });

  it("stellt leere Werte in BEIDE Richtungen ans Ende", async () => {
    // Die Tauchpumpe (ohne Ort) steht bewusst VORNE in der Eingabe: Bliebe sie
    // nur deshalb unten, weil `sort` stabil ist, bewiese der Test nichts.
    const ansicht = baueTabelle({ geraete: [pumpe, walze, ruettler] });
    // Spalte „Ort": Das Kästchen hat keinen Kopfknopf, also Nummer=0 … Ort=3.
    const ortkopf = ansicht.findAll("button.kopfknopf")[3]!;

    await ortkopf.trigger("click");
    expect(zeilen(ansicht).map((z) => z.text())).toEqual([
      expect.stringContaining("Rüttelplatte"),
      expect.stringContaining("Walze"),
      expect.stringContaining("Tauchpumpe"),
    ]);

    // Absteigend rutscht die Tauchpumpe NICHT nach oben — sonst füllte ein
    // Klick die erste Bildschirmseite mit Strichen.
    await ortkopf.trigger("click");
    expect(zeilen(ansicht).map((z) => z.text())).toEqual([
      expect.stringContaining("Walze"),
      expect.stringContaining("Rüttelplatte"),
      expect.stringContaining("Tauchpumpe"),
    ]);
  });

  it("öffnet das Detail beim Klick auf die Zeile", async () => {
    const ansicht = baueTabelle();
    await zeilen(ansicht)[0]!.trigger("click");
    expect(ansicht.emitted("oeffnen")?.[0]).toEqual(["g1"]);
  });

  it("schaltet beim Kästchen um, ohne das Detail zu öffnen", async () => {
    const ansicht = baueTabelle();
    const kaesten = ansicht.findAll("input.kasten__feld");
    // Der erste ist das Kopfkästchen, danach je Zeile eines.
    await kaesten[1]!.trigger("change");
    await kaesten[1]!.trigger("click");

    expect(ansicht.emitted("umschalten")?.[0]).toEqual(["g1"]);
    expect(ansicht.emitted("oeffnen")).toBeUndefined();
  });

  it("wählt mit dem Kopfkästchen genau die sichtbaren Zeilen, in Anzeigereihenfolge", async () => {
    // Nur zwei Geräte sichtbar — etwa nach einem Filter auf „Bauhof Nord".
    const ansicht = baueTabelle({ geraete: [pumpe, ruettler] });
    await ansicht.findAll("input.kasten__feld")[0]!.trigger("change");

    expect(ansicht.emitted("alle")?.[0]).toEqual([["g2", "g3"]]);
  });

  it("hebt die Auswahl auf, wenn schon alle sichtbaren gewählt sind", async () => {
    const ansicht = baueTabelle({ auswahl: ["g1", "g2", "g3"] });
    await ansicht.findAll("input.kasten__feld")[0]!.trigger("change");

    expect(ansicht.emitted("keine")).toHaveLength(1);
    expect(ansicht.emitted("alle")).toBeUndefined();
  });

  it("zeigt ohne das Recht buchungen.erfassen gar keine Kästchen", () => {
    const ansicht = baueTabelle({ waehlbar: false });
    expect(ansicht.findAll("input.kasten__feld")).toHaveLength(0);
  });

  it("markiert eine überschrittene Rückgabe und lässt leere Werte als Strich stehen", async () => {
    api.get.mockResolvedValue([
      { geraet_id: "g1", tage: 63, ueberfaellig: true },
      { geraet_id: "g2", tage: 3, ueberfaellig: false },
    ]);
    const ansicht = mount(GeraeteTabelle, {
      props: { geraete: [walze, ruettler, pumpe], auswahl: [], waehlbar: true },
      global: { stubs: { StatusChip: true, Symbol: true } },
    });
    await new Promise((f) => setTimeout(f, 0));
    await ansicht.vm.$nextTick();

    const reihen = zeilen(ansicht);
    expect(reihen[0]!.text()).toContain("63 Tage");
    expect(reihen[0]!.find(".seit--ueberfaellig").exists()).toBe(true);
    expect(reihen[1]!.find(".seit--ueberfaellig").exists()).toBe(false);
    // Ohne offene Ausgabe steht ein Strich, keine erfundene Null.
    expect(reihen[2]!.text()).toContain("—");
  });
});

// ── Die Ansicht drumherum ──────────────────────────────────────────────────

async function baueAnsicht(rechte: string[] = ["buchungen.erfassen"], mitFinger = false) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;
  const bestand = useBestand();
  bestand.geraete = [walze, ruettler, pumpe];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  // jsdom wertet Medienabfragen nicht aus und meldet immer `false`.
  const { breit, tablet } = useBreite();
  breit.value = true;
  tablet.value = mitFinger;

  api.get.mockResolvedValue([]);
  const ansicht = mount(GeraeteView, {
    global: { stubs: { Kopf: true, TopLeiste: false, Symbol: true, StatusChip: true } },
  });
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

describe("Geräteansicht am Computer", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    gedrueckt.mockReset();
  });

  it("zeigt die Tabelle statt der Kartenliste", async () => {
    const { ansicht } = await baueAnsicht();
    expect(ansicht.findComponent(GeraeteTabelle).exists()).toBe(true);
    // Die Kartenliste des Handys darf am Schreibtisch nicht zusätzlich stehen.
    expect(ansicht.find("ul.liste").exists()).toBe(false);
  });

  it("tauscht am iPad Tabelle und offenes Suchfeld gegen Karten und Suchknopf", async () => {
    const { ansicht } = await baueAnsicht(["buchungen.erfassen"], true);
    // Mit dem Finger trifft niemand eine 48-px-Zeile mit 18-px-Kästchen.
    expect(ansicht.findComponent(GeraeteKarten).exists()).toBe(true);
    expect(ansicht.findComponent(GeraeteTabelle).exists()).toBe(false);
    // Auf 1024 px nähme ein dauerhaft offenes 320-px-Feld den Platz der Aktion.
    expect(ansicht.findComponent(SuchKnopf).exists()).toBe(true);
    expect(ansicht.find("input.kopfsuche__feld").exists()).toBe(false);
  });

  it("zählt die Filterkacheln über die Suchtreffer, nicht über den ganzen Bestand", async () => {
    const { ansicht } = await baueAnsicht();
    const kacheln = () => ansicht.findAll("button.pille").map((p) => p.text());

    expect(kacheln()[0]).toBe("Alle 3");

    await ansicht.find("input.kopfsuche__feld").setValue("Bomag");
    await ansicht.vm.$nextTick();
    // Eine Kachel, die weiter 3 behauptet, widerspräche der Liste daneben.
    expect(kacheln()[0]).toBe("Alle 1");
  });

  it("schreibt die Auswahl in bestand.sammlung — dieselbe wie am Handy", async () => {
    const { ansicht, bestand } = await baueAnsicht();
    ansicht.findComponent(GeraeteTabelle).vm.$emit("umschalten", "g2");
    await ansicht.vm.$nextTick();

    expect(bestand.sammlung).toEqual(["g2"]);
    expect(ansicht.findComponent(SammelPanel).exists()).toBe(true);
  });

  it("bietet ohne buchungen.erfassen keine Sammelausgabe an", async () => {
    const { ansicht, bestand } = await baueAnsicht(["geraete.pflegen"]);
    bestand.sammle("g2");
    await ansicht.vm.$nextTick();

    expect(ansicht.findComponent(SammelPanel).exists()).toBe(false);
    expect(ansicht.findComponent(GeraeteTabelle).props("waehlbar")).toBe(false);
  });
});

// ── Sammelausgabe ──────────────────────────────────────────────────────────

const loeffel = {
  id: "z1",
  inventarnummer: "10090",
  bezeichnung: "Tieflöffel 40 cm",
  status: "verfuegbar",
  standort: null,
};

async function bauePanel(zubehoer: unknown[] = []) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = ["buchungen.erfassen"];
  const bestand = useBestand();
  bestand.geraete = [walze, ruettler];
  bestand.standorte = [
    { id: "s1", name: "Donaufeld", typ: "baustelle", aktiv: true } as Standort,
  ];
  bestand.sammle("g1");
  bestand.sammle("g2");

  api.get.mockImplementation(async (pfad: string) => {
    // Nur das erste Gerät hat Zubehör — sonst käme der Löffel doppelt.
    if (pfad === "/geraete/g1/zubehoer") return zubehoer;
    if (pfad.includes("/zubehoer")) return [];
    if (pfad === "/benutzer") return [{ id: "b1", anzeigename: "Julius" }];
    return [];
  });

  const ansicht = mount(SammelPanel, { global: { stubs: { Symbol: true } } });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

describe("Sammelausgabe am Computer", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
  });

  it("bucht die ganze Auswahl in EINEM Aufruf", async () => {
    api.post.mockResolvedValue({ geraete: [walze, ruettler] });
    const { ansicht } = await bauePanel();

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post).toHaveBeenCalledOnce();
    const [pfad, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(pfad).toBe("/buchungen/sammel");
    expect(koerper.geraet_ids).toEqual(["g1", "g2"]);
  });

  it("bucht vorangehaktes Zubehör mit und lässt Abgewähltes weg", async () => {
    api.post.mockResolvedValue({ geraete: [walze, ruettler] });
    const { ansicht } = await bauePanel([loeffel]);

    const haken = ansicht.find('input[type="checkbox"]');
    // Vorangehakt: Der Löffel fährt mit dem Bagger, das ist der Regelfall.
    expect((haken.element as HTMLInputElement).checked).toBe(true);

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    let [, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(koerper.geraet_ids).toEqual(["g1", "g2", "z1"]);

    // Manchmal bleibt der Löffel da — dann darf er nicht mitgebucht werden.
    api.post.mockClear();
    const zweite = await bauePanel([loeffel]);
    await zweite.ansicht.find('input[type="checkbox"]').trigger("change");
    await zweite.ansicht.vm.$nextTick();
    await zweite.ansicht
      .findAll("button")
      .find((b) => b.text().includes("ausgeben"))
      ?.trigger("click");

    [, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(koerper.geraet_ids).toEqual(["g1", "g2"]);
  });

  it("hakt abgewähltes Zubehör nicht wieder an, wenn sich die Auswahl ändert", async () => {
    // Der schwerste der fünf Fehler aus AP25. Am Computer ist er am
    // wahrscheinlichsten: Die Tabelle steht daneben, und zwischen Abwählen
    // und Buchen wird weitergeklickt.
    api.post.mockResolvedValue({ geraete: [walze] });
    const { ansicht, bestand } = await bauePanel([loeffel]);

    await ansicht.find('input[type="checkbox"]').trigger("change"); // Löffel abwählen
    await ansicht.vm.$nextTick();

    // g2 entfernen, NICHT g1: Am ersten Gerät hängt der Löffel; nähme man es
    // heraus, verschwände das Zubehör ganz und die Prüfung beliefe nichts.
    bestand.entsammle("g2");
    await new Promise((f) => setTimeout(f, 0));
    await ansicht.vm.$nextTick();

    expect(ansicht.text()).toContain("Tieflöffel 40 cm");
    expect((ansicht.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      false,
    );

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    const [, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(koerper.geraet_ids).toEqual(["g1"]);
  });

  it("nimmt das vom Server genannte Gerät aus der Auswahl", async () => {
    const { ApiError } = await import("@/api");
    api.post.mockRejectedValue(
      new ApiError(409, "Walze Bomag (10008): Dieses Gerät ist bereits ausgegeben."),
    );
    const { ansicht, bestand } = await bauePanel();

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    await ansicht.vm.$nextTick();

    // Der Wortlaut des Servers bleibt stehen — er nennt das Gerät beim Namen.
    expect(ansicht.text()).toContain("Walze Bomag (10008)");
    // Und genau dieses Gerät ist raus, sonst scheitert der nächste Versuch
    // wieder an derselben Stelle.
    expect(bestand.sammlung).toEqual(["g2"]);
  });

  it("nimmt auch ein genanntes Zubehörteil heraus — und lässt es draußen", async () => {
    const { ApiError } = await import("@/api");
    api.post.mockRejectedValue(
      new ApiError(409, "Tieflöffel 40 cm (10090): Dieses Gerät ist bereits ausgegeben."),
    );
    const { ansicht, bestand } = await bauePanel([loeffel]);

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    await ansicht.vm.$nextTick();
    expect((ansicht.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      false,
    );

    // Und es bleibt draußen: Griffe das Herausnehmen in die Liste der
    // Gewählten statt in die der Abgewählten, hakte der nächste Ladevorgang
    // es wieder an — der zweite Versuch scheiterte an derselben Stelle.
    bestand.entsammle("g2");
    await new Promise((f) => setTimeout(f, 0));
    await ansicht.vm.$nextTick();
    expect((ansicht.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("bucht auch ein einzelnes Gerät über die Sammelroute", async () => {
    // Keine Abkürzung auf `POST /buchungen`: Nur `bucheMehrere` stellt der
    // Fehlermeldung den Gerätenamen voran, und allein daran erkennt
    // `nimmGenanntesHeraus` das schuldige Gerät wieder.
    api.post.mockResolvedValue({ geraete: [walze] });
    const { ansicht, bestand } = await bauePanel();
    bestand.entsammle("g2");
    await ansicht.vm.$nextTick();

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    const [pfad, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(pfad).toBe("/buchungen/sammel");
    expect(koerper.geraet_ids).toEqual(["g1"]);
  });

  it("lässt die Auswahl in Ruhe, wenn die Meldung kein Gerät nennt", async () => {
    const { ApiError } = await import("@/api");
    api.post.mockRejectedValue(new ApiError(403, "Keine Berechtigung."));
    const { ansicht, bestand } = await bauePanel();

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(bestand.sammlung).toEqual(["g1", "g2"]);
  });

  it("meldet die Anzahl nach oben und leert die Sammlung", async () => {
    api.post.mockResolvedValue({ geraete: [walze, ruettler] });
    const { ansicht, bestand } = await bauePanel();

    await ansicht.findAll("button").find((b) => b.text().includes("ausgeben"))?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(ansicht.emitted("gebucht")?.[0]).toEqual([2]);
    expect(bestand.sammlung).toEqual([]);
  });
});
