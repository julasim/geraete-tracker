/**
 * Der Buchungsdialog der Computer-Oberfläche.
 *
 * Er macht dasselbe wie `views/BuchenView.vue` am Handy, nur über der Liste
 * statt auf einer eigenen Seite. Geprüft wird deshalb hier vor allem das,
 * was am Dialog neu ist — und die drei fachlichen Regeln, die beim Umziehen
 * in eine andere Hülle am leichtesten verlorengehen:
 *
 * 1. **Warnungen erfindet niemand.** Sie kommen wortgleich aus
 *    `GET /scan/:nummer`, derselben Quelle wie beim Scannen. Sonst behaupten
 *    Gerätekarte und Dialog Verschiedenes.
 * 2. **Nur angehaktes Zubehör geht mit.** Der Löffel fährt meist mit dem
 *    Bagger, manchmal bleibt er da.
 * 3. **Ein gescheitertes Zustandsfoto wirft die Buchung nicht um** — und der
 *    Dialog darf trotzdem nicht verschwinden, sonst liest niemand die
 *    Warnung dazu. Genau das ist am Handy schon einmal passiert (AP22).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import BuchenDialog from "@/components/BuchenDialog.vue";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Benutzer, Buchungsart, Geraet, Lagerplatz, Standort, Warnung } from "@/typen";

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

/**
 * Die Haltung steckt in einer Medienabfrage; jsdom wertet keine aus. Der
 * Dialog benutzt sie ohnehin nur für die Tippzielgröße (CSS).
 */
vi.mock("@/composables/useBreite", () => ({
  useBreite: () => ({ breit: { value: true }, tablet: { value: false } }),
}));

/**
 * Die Bildverkleinerung reicht die Datei unverändert durch — hier irrelevant.
 *
 * Der Schalter lässt sie auf Wunsch scheitern. Der Name muss mit `mock`
 * beginnen: Vitest zieht `vi.mock` an den Dateianfang und lässt in der
 * Fabrik nur so benannte Bezeichner aus dem Umfeld zu.
 */
let mockVorbereitungScheitert = false;

vi.mock("@/composables/useFoto", () => ({
  useFoto: () => ({
    arbeitet: { value: false },
    fehler: { value: null },
    vorbereiten: vi.fn(async (roh: File) => {
      if (mockVorbereitungScheitert) throw new Error("Bild kaputt");
      return { datei: roh, vorschau: "blob:vorschau", vorher: 1000, nachher: 100 };
    }),
  }),
}));

/** Statt der echten Strichzeichnung ein Element, an dem der Name ablesbar ist. */
const SymbolStub = {
  props: { name: { type: String, required: true }, groesse: Number },
  template: '<i :data-symbol="name"></i>',
};

const geraet = {
  id: "g1",
  inventarnummer: "10014",
  bezeichnung: "Rüttelplatte Wacker Neuson DPU 6555",
  status: "verfuegbar",
  standort: "Bauhof Nord",
  lagerplatz: "Regal C3",
  schlagworte: [],
} as unknown as Geraet;

const wagen = {
  id: "z1",
  inventarnummer: "10015",
  bezeichnung: "Transportwagen DPU",
  status: "verfuegbar",
  standort: null,
};
const hammer = {
  id: "z2",
  inventarnummer: "10016",
  bezeichnung: "Hydraulikhammer",
  status: "verfuegbar",
  standort: null,
};
/** Dasselbe Teil, aber draußen — nur so lässt es sich zurücknehmen. */
const wagenDraussen = { ...wagen, status: "ausgegeben" };

const ORTE = [
  { id: "s1", name: "Baustelle Nord", typ: "baustelle", aktiv: true },
  { id: "s3", name: "Donaufeld Bauteil B", typ: "baustelle", aktiv: true },
  { id: "s2", name: "Bauhof Nord", typ: "lager", aktiv: true },
] as Standort[];

const neuerOrt = {
  id: "s9",
  name: "Lindengasse 14",
  typ: "baustelle",
  adresse: null,
  notiz: null,
  aktiv: true,
} as Standort;

interface Aufbau {
  art?: Buchungsart;
  rechte?: string[];
  zubehoer?: unknown[];
  warnungen?: Warnung[];
  lagerplaetze?: Lagerplatz[];
}

/** Zwei Regale an zwei verschiedenen Orten — für die Ort/Platz-Kopplung. */
const PLAETZE = [
  { id: "p1", standort_id: "s1", bezeichnung: "Regal A1", barcode: null, aktiv: true },
  { id: "p2", standort_id: "s3", bezeichnung: "Regal B2", barcode: null, aktiv: true },
] as Lagerplatz[];

let offen: { unmount: () => void } | null = null;

async function baue(opts: Aufbau = {}) {
  setActivePinia(createPinia());

  const anmeldung = useAnmeldung();
  anmeldung.rechte = opts.rechte ?? [
    "buchungen.erfassen",
    "stammdaten.pflegen",
    "dateien.hochladen",
    "schaeden.melden",
  ];
  anmeldung.benutzer = {
    id: "b1",
    benutzername: "julius",
    anzeigename: "Julius",
    email: null,
    rolle: "verwaltung",
  } as Benutzer;

  const bestand = useBestand();
  bestand.geraete = [geraet];
  bestand.standorte = ORTE;
  bestand.lagerplaetze = opts.lagerplaetze ?? [];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  api.get.mockImplementation(async (pfad: string) => {
    if (pfad.includes("/zubehoer")) return opts.zubehoer ?? [];
    if (pfad === "/benutzer") {
      return [
        { id: "b1", anzeigename: "Julius" },
        { id: "b2", anzeigename: "M. Wallner" },
      ];
    }
    if (pfad.startsWith("/scan/")) return { warnungen: opts.warnungen ?? [] };
    return [];
  });

  const ansicht = mount(BuchenDialog, {
    props: { geraet, art: opts.art ?? "ausgabe" },
    attachTo: document.body,
    global: { stubs: { Symbol: SymbolStub, StatusChip: true } },
  });
  offen = ansicht;

  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

type Ansicht = Awaited<ReturnType<typeof baue>>["ansicht"];

const knopf = (a: Ansicht, text: string) => a.findAll("button").find((b) => b.text() === text);

async function fotoWaehlen(a: Ansicht) {
  const feld = a.find('input[type="file"]');
  const datei = new File(["x"], "zustand.jpg", { type: "image/jpeg" });
  Object.defineProperty(feld.element, "files", { value: [datei], configurable: true });
  await feld.trigger("change");
  await a.vm.$nextTick();
}

function fetchAntwort(ok: boolean) {
  return vi.fn().mockResolvedValue({ ok, json: async () => ({}) });
}

beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  api.post.mockReset().mockImplementation(async (pfad: string) => {
    if (pfad === "/standorte") return neuerOrt;
    if (pfad === "/buchungen/ruecknahme-defekt") {
      return { buchung_id: "b-eigene", schaden: { id: "s-1" }, geraet: { ...geraet, status: "defekt" } };
    }
    if (pfad.endsWith("/schaeden")) {
      return { schaden: { id: "s-1" }, geraet: { ...geraet, status: "defekt" } };
    }
    if (pfad === "/buchungen/sammel") {
      return {
        geraete: [geraet],
        buchungen: [
          { id: "b-zubehoer", geraet_id: "z1" },
          { id: "b-eigene", geraet_id: "g1" },
        ],
      };
    }
    return { geraet, buchung: { id: "b-eigene", geraet_id: "g1" } };
  });
  vi.stubGlobal("fetch", fetchAntwort(true));
});

afterEach(() => {
  offen?.unmount();
  offen = null;
});

describe("Kopf und Rahmen", () => {
  it("nennt Buchungsart, Gerät, Nummer und aktuellen Standort", async () => {
    const { ansicht } = await baue();
    expect(ansicht.text()).toContain("Ausgeben");
    expect(ansicht.text()).toContain("Rüttelplatte Wacker Neuson DPU 6555");
    // Ohne den Standort wüsste niemand, woher das Gerät kommt.
    expect(ansicht.text()).toContain("10014 · Bauhof Nord, Regal C3");
  });

  it("ist als Dialog ausgezeichnet und nimmt den Fokus", async () => {
    const { ansicht } = await baue();
    const dialog = ansicht.find('[role="dialog"]');
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("aria-modal")).toBe("true");
    // Sonst bliebe der Fokus in der Liste dahinter stehen.
    expect(document.activeElement).toBe(dialog.element);
  });

  it("lässt den Fokus nicht hinter den Dialog wandern", async () => {
    const { ansicht } = await baue();
    const bedienbar = ansicht
      .find('[role="dialog"]')
      .element.querySelectorAll<HTMLElement>("button, input, select");
    const erstes = bedienbar[0]!;
    const letztes = bedienbar[bedienbar.length - 1]!;

    // Rückwärts vom Dialog aus: ans Ende, nicht in die Tabelle dahinter.
    await ansicht.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(letztes);

    // Und vom letzten Bedienelement vorwärts wieder an den Anfang.
    await ansicht.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(erstes);
  });
});

describe("Schließen", () => {
  it("meldet schliessen bei Escape", async () => {
    const { ansicht } = await baue();
    await ansicht.trigger("keydown", { key: "Escape" });
    expect(ansicht.emitted("schliessen")).toHaveLength(1);
  });

  it("meldet schliessen beim Klick auf den Hintergrund, nicht auf den Dialog", async () => {
    const { ansicht } = await baue();

    await ansicht.find(".buchdialog").trigger("click");
    expect(ansicht.emitted("schliessen")).toBeUndefined();

    await ansicht.trigger("click");
    expect(ansicht.emitted("schliessen")).toHaveLength(1);
  });

  it("meldet schliessen über das Kreuz", async () => {
    const { ansicht } = await baue();
    await ansicht.find('[aria-label="Dialog schließen"]').trigger("click");
    expect(ansicht.emitted("schliessen")).toHaveLength(1);
  });

  it("schließt bei offener Baustellen-Eingabe nur diese", async () => {
    const { ansicht } = await baue();
    await knopf(ansicht, "Baustelle ist noch nicht dabei")?.trigger("click");
    await ansicht.vm.$nextTick();
    expect(ansicht.find("#bd-neuer-ort").exists()).toBe(true);

    await ansicht.trigger("keydown", { key: "Escape" });
    await ansicht.vm.$nextTick();

    // Der halb ausgefüllte Dialog darf einen Tastendruck überleben.
    expect(ansicht.emitted("schliessen")).toBeUndefined();
    expect(ansicht.find("#bd-neuer-ort").exists()).toBe(false);
  });
});

describe("Warnungen", () => {
  it("zeigt die Warnungen des Servers wortgleich, mit Warndreieck", async () => {
    const text = "Elektro E-Check war am 12.08.2026 fällig.";
    const { ansicht } = await baue({ warnungen: [{ art: "pruefung", text }] });

    const meldung = ansicht.find(".pt-meldung--warnung");
    expect(meldung.exists()).toBe(true);
    expect(meldung.text()).toContain(text);
    expect(meldung.find('[data-symbol="warnung"]').exists()).toBe(true);
  });

  it("zeigt ohne Warnung des Servers auch keine", async () => {
    const { ansicht } = await baue();
    expect(ansicht.find(".pt-meldung--warnung").exists()).toBe(false);
  });
});

describe("Vorbelegung", () => {
  it("nimmt den zuletzt gewählten Ort, wenn er noch passt", async () => {
    localStorage.setItem("gt-letzter-ort-ausgabe", "s3");
    const { ansicht } = await baue();
    expect((ansicht.find("#bd-ort").element as HTMLSelectElement).value).toBe("s3");
  });

  it("nimmt ohne gemerkten Ort den ersten möglichen", async () => {
    const { ansicht } = await baue();
    expect((ansicht.find("#bd-ort").element as HTMLSelectElement).value).toBe("s1");
  });

  it("leert den Lagerplatz, sobald der Ort wechselt", async () => {
    // Der Platz gehört zum Ort. Blieb er beim Wechsel stehen, wies der Server
    // die Buchung mit 409 ab — während das Formular richtig aussah und die
    // Auswahl nur leer anzeigte.
    const { ansicht } = await baue({ lagerplaetze: PLAETZE });
    await ansicht.find("#bd-platz").setValue("p1");
    expect((ansicht.find("#bd-platz").element as HTMLSelectElement).value).toBe("p1");

    await ansicht.find("#bd-ort").setValue("s3");
    await ansicht.vm.$nextTick();

    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    const [, koerper] = api.post.mock.calls[0] as [string, { nach_lagerplatz_id: string | null }];
    expect(koerper.nach_lagerplatz_id).toBe(null);
  });

  it("merkt sich den Ort nach dem Buchen", async () => {
    const { ansicht } = await baue();
    await ansicht.find("#bd-ort").setValue("s3");
    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();
    expect(localStorage.getItem("gt-letzter-ort-ausgabe")).toBe("s3");
  });
});

describe("Zubehör", () => {
  it("schlägt das Zubehör vorangehakt vor", async () => {
    const { ansicht } = await baue({ zubehoer: [wagen, hammer] });
    expect(ansicht.text()).toContain("Transportwagen DPU");

    const haken = ansicht.findAll('.buchzubehoer input[type="checkbox"]');
    expect(haken).toHaveLength(2);
    expect((haken[0]!.element as HTMLInputElement).checked).toBe(true);
    expect((haken[1]!.element as HTMLInputElement).checked).toBe(true);
  });

  it("bucht Gerät und Zubehör in EINEM Aufruf", async () => {
    const { ansicht } = await baue({ zubehoer: [wagen, hammer] });
    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post).toHaveBeenCalledOnce();
    const [pfad, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(pfad).toBe("/buchungen/sammel");
    expect(koerper.geraet_ids).toEqual(["g1", "z1", "z2"]);
  });

  it("lässt abgewähltes Zubehör wirklich weg", async () => {
    const { ansicht } = await baue({ zubehoer: [wagen, hammer] });
    // Den Hydraulikhammer abwählen — er bleibt im Lager.
    await ansicht.findAll('.buchzubehoer input[type="checkbox"]')[1]!.trigger("change");
    await ansicht.vm.$nextTick();

    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    const [, koerper] = api.post.mock.calls[0] as [string, { geraet_ids: string[] }];
    expect(koerper.geraet_ids).toContain("z1");
    expect(koerper.geraet_ids).not.toContain("z2");
  });
});

describe("Rücknahme", () => {
  it("zeigt statt des Empfängers den Ausfall-Schalter", async () => {
    const { ansicht } = await baue({ art: "ruecknahme" });
    expect(ansicht.text()).toContain("Gerät ist defekt");
    expect(ansicht.text()).not.toContain("Wer übernimmt es?");
    // Ins Lager zurück geht es an Orte, die es längst gibt.
    expect(knopf(ansicht, "Baustelle ist noch nicht dabei")).toBeUndefined();
  });

  it("zeigt den Ausfall-Schalter ohne schaeden.melden gar nicht erst", async () => {
    const { ansicht } = await baue({ art: "ruecknahme", rechte: ["buchungen.erfassen"] });
    // Aus dem Haken wird eine Schadensmeldung; ohne das Recht liefe sie in
    // einen 403, nachdem die Buchung schon steht.
    expect(ansicht.text()).not.toContain("Gerät ist defekt");
    expect(ansicht.find(".buchschalter__feld").exists()).toBe(false);
  });

  it("bietet nur Zubehör an, das überhaupt zurückgenommen werden kann", async () => {
    // `zubehoerVon` liefert alles, was nicht ausgemustert ist. Der
    // Zustandsautomat lässt eine Rücknahme aber nur aus `ausgegeben` zu — und
    // die Sammelbuchung ist alles oder nichts. Ein Löffel, der im Regal
    // geblieben ist, ließe sonst die ganze Rücknahme scheitern.
    const { ansicht } = await baue({ art: "ruecknahme", zubehoer: [wagenDraussen, hammer] });
    expect(ansicht.text()).toContain("Transportwagen DPU");
    expect(ansicht.text()).not.toContain("Hydraulikhammer");
  });
});

/**
 * Der Defekt-Haken bei der Rücknahme.
 *
 * Er war bis AP25 ein Feld an der Buchung — und ging beim Weg mit Zubehör
 * stillschweigend verloren, weil `bucheMehrere` die Angaben unverändert an
 * JEDES Gerät weiterreicht und der Löffel sonst mitgesperrt worden wäre. Der
 * Bagger kam kaputt zurück, stand auf `verfuegbar` und wurde am nächsten
 * Morgen wieder ausgegeben.
 *
 * Jetzt wird ein Schaden gemeldet: gleicher Effekt (der Server setzt bei
 * Schwere `ausfall` den Zustand auf `defekt`), aber mit einem Datensatz, den
 * man normal erledigen kann.
 */
describe("Defekt bei der Rücknahme", () => {
  const schaedenPfad = "/geraete/g1/schaeden";

  it("bucht Rücknahme und Defekt in einer Transaktion", async () => {
    const { ansicht } = await baue({ art: "ruecknahme" });
    await ansicht.find(".buchschalter__feld").setValue(true);
    await knopf(ansicht, "Zurücknehmen")?.trigger("click");
    await ansicht.vm.$nextTick();

    // Ohne Zubehör geht alles in EINEM Aufruf — kein Zwischenzustand.
    expect(api.post).toHaveBeenCalledOnce();
    const [pfad, koerper] = api.post.mock.calls[0] as [string, { beschreibung: string }];
    expect(pfad).toBe("/buchungen/ruecknahme-defekt");
    expect(koerper.beschreibung).toContain("Bei der Rücknahme als defekt gemeldet");
    expect(ansicht.emitted("gebucht")).toHaveLength(1);
  });

  it("nimmt die Notiz des Benutzers in die Beschreibung auf", async () => {
    const { ansicht } = await baue({ art: "ruecknahme" });
    await ansicht.find("#bd-notiz").setValue("Hydraulikschlauch gerissen");
    await ansicht.find(".buchschalter__feld").setValue(true);
    await knopf(ansicht, "Zurücknehmen")?.trigger("click");
    await ansicht.vm.$nextTick();

    const [, koerper] = api.post.mock.calls[0] as [string, { beschreibung: string }];
    expect(koerper.beschreibung).toContain("Hydraulikschlauch gerissen");
  });

  it("meldet den Defekt auch, wenn Zubehör mitgeht — und nur für das Gerät", async () => {
    const { ansicht } = await baue({ art: "ruecknahme", zubehoer: [wagenDraussen] });
    await ansicht.find(".buchschalter__feld").setValue(true);
    await knopf(ansicht, "Zurücknehmen")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post.mock.calls[0]![0]).toBe("/buchungen/sammel");
    // Genau EIN Schaden, und zwar am Bagger — nicht am Transportwagen.
    const schaeden = api.post.mock.calls.filter((c) => String(c[0]).endsWith("/schaeden"));
    expect(schaeden).toHaveLength(1);
    expect(schaeden[0]![0]).toBe(schaedenPfad);
  });

  it("meldet ohne gesetzten Haken gar keinen Schaden", async () => {
    const { ansicht } = await baue({ art: "ruecknahme" });
    await knopf(ansicht, "Zurücknehmen")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post.mock.calls.filter((c) => String(c[0]).endsWith("/schaeden"))).toHaveLength(0);
  });

  it("lässt die Buchung stehen, wenn die Schadensmeldung scheitert", async () => {
    // Nur beim Sammelweg (MIT Zubehör) sind Buchung und Schadensmeldung zwei
    // getrennte Aufrufe — der Einzelweg läuft transaktional.
    const { ApiError } = await import("@/api");
    const vorher = api.post.getMockImplementation()!;
    api.post.mockImplementation(async (pfad: string, koerper?: unknown) => {
      if (pfad === schaedenPfad) throw new ApiError(403, "Keine Berechtigung.");
      return vorher(pfad, koerper);
    });

    const { ansicht } = await baue({ art: "ruecknahme", zubehoer: [wagenDraussen] });
    await ansicht.find(".buchschalter__feld").setValue(true);
    await knopf(ansicht, "Zurücknehmen")?.trigger("click");
    await new Promise((f) => setTimeout(f, 0));
    await ansicht.vm.$nextTick();

    // Die Buchung ist erfolgt …
    expect(ansicht.text()).toContain("Die Buchung ist erfasst.");
    // … und der Benutzer erfährt, dass das Gerät NICHT gesperrt ist.
    expect(ansicht.text()).toContain("der Defekt konnte nicht gemeldet werden");
    // Solange die Warnung ungelesen ist, verschwindet der Dialog nicht.
    expect(ansicht.emitted("gebucht")).toBeUndefined();
  });
});

describe("Baustelle aus dem Vorgang heraus anlegen", () => {
  it("bietet es nur mit dem Recht stammdaten.pflegen an", async () => {
    const { ansicht } = await baue({ rechte: ["buchungen.erfassen"] });
    expect(knopf(ansicht, "Baustelle ist noch nicht dabei")).toBeUndefined();
  });

  it("warnt vor einer Dublette, ohne zu blockieren", async () => {
    const { ansicht } = await baue();
    await knopf(ansicht, "Baustelle ist noch nicht dabei")?.trigger("click");
    await ansicht.find("#bd-neuer-ort").setValue("Bauhof");
    await ansicht.vm.$nextTick();

    expect(ansicht.text()).toContain("Es gibt bereits „Bauhof Nord“.");
    // Es kann ja ein anderer Ort sein — der Hinweis hält niemanden auf.
    expect(knopf(ansicht, "Anlegen und wählen")?.attributes("disabled")).toBeUndefined();
  });

  it("wählt die angelegte Baustelle sofort aus", async () => {
    const { ansicht, bestand } = await baue();
    await knopf(ansicht, "Baustelle ist noch nicht dabei")?.trigger("click");
    await ansicht.find("#bd-neuer-ort").setValue("Lindengasse 14");
    await knopf(ansicht, "Anlegen und wählen")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(bestand.standorte.some((s) => s.id === "s9")).toBe(true);
    expect((ansicht.find("#bd-ort").element as HTMLSelectElement).value).toBe("s9");
  });
});

describe("Buchen", () => {
  it("meldet die Buchung DIESES Geräts, nicht die erste der Sammelantwort", async () => {
    const { ansicht } = await baue({ zubehoer: [wagen] });
    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    const gemeldet = ansicht.emitted("gebucht");
    expect(gemeldet).toHaveLength(1);
    expect((gemeldet![0]![0] as { id: string }).id).toBe("b-eigene");
  });

  it("reicht die Fehlermeldung des Servers wörtlich durch und meldet nichts", async () => {
    const { ansicht } = await baue();
    const { ApiError } = await import("@/api");
    api.post.mockRejectedValue(
      new ApiError(409, "Rüttelplatte (10014): Dieses Gerät ist bereits ausgegeben."),
    );

    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(ansicht.find(".pt-meldung--fehler").text()).toBe(
      "Rüttelplatte (10014): Dieses Gerät ist bereits ausgegeben.",
    );
    expect(ansicht.emitted("gebucht")).toBeUndefined();
  });
});

describe("Zustandsfoto", () => {
  it("bucht ohne Foto, ohne etwas hochzuladen", async () => {
    const { ansicht } = await baue();
    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lädt das Foto NACH der Buchung hoch, mit deren Kennung", async () => {
    const { ansicht } = await baue();
    await fotoWaehlen(ansicht);
    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(fetch).toHaveBeenCalledOnce();
    const [pfad, aufruf] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(pfad).toBe("/api/geraete/g1/dateien");
    // Ohne die Kennung hinge das Bild am Gerät statt am Vorgang.
    expect((aufruf.body as FormData).get("buchung_id")).toBe("b-eigene");
  });

  it("hängt das Foto an die eigene Buchung, nicht an die des Zubehörs", async () => {
    const { ansicht } = await baue({ zubehoer: [wagen] });
    await fotoWaehlen(ansicht);
    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    const [, aufruf] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect((aufruf.body as FormData).get("buchung_id")).toBe("b-eigene");
  });

  it("hält den Dialog offen, wenn das Hochladen scheitert", async () => {
    vi.stubGlobal("fetch", fetchAntwort(false));
    const { ansicht } = await baue();
    await fotoWaehlen(ansicht);
    await knopf(ansicht, "Ausgeben")?.trigger("click");
    await ansicht.vm.$nextTick();

    // Die Buchung ist erfolgt …
    expect(api.post).toHaveBeenCalledOnce();
    // … und der Benutzer erfährt genau das.
    expect(ansicht.text()).toContain("Die Buchung ist gespeichert");
    // Solange die Warnung ungelesen ist, verschwindet der Dialog nicht.
    expect(ansicht.emitted("gebucht")).toBeUndefined();

    await knopf(ansicht, "Schließen")?.trigger("click");
    expect(ansicht.emitted("gebucht")).toHaveLength(1);
  });

  it("hält den Dialog NICHT offen, wenn nur die Bildvorbereitung scheitert", async () => {
    // Der Unterschied zum Test darüber: Hier ist nichts verloren. Das Bild
    // wurde nie hochgeladen, die Buchung ist vollständig geglückt — den
    // Benutzer dafür ein zweites Mal klicken zu lassen, wäre Schikane.
    mockVorbereitungScheitert = true;
    try {
      const { ansicht } = await baue();
      await fotoWaehlen(ansicht);
      expect(ansicht.text()).toContain("Das Bild konnte nicht vorbereitet werden");

      await knopf(ansicht, "Ausgeben")?.trigger("click");
      await ansicht.vm.$nextTick();

      expect(api.post).toHaveBeenCalledOnce();
      // Kein Upload versucht — es gab ja keine Datei.
      expect(fetch).not.toHaveBeenCalled();
      expect(ansicht.emitted("gebucht")).toHaveLength(1);
    } finally {
      mockVorbereitungScheitert = false;
    }
  });
});
