/**
 * Das Gerätedetail am Computer.
 *
 * Geprüft wird ausschließlich, was gegenüber dem Handy NEU ist — und dabei
 * das, was still kaputtgehen kann:
 *
 * * **Keine erfundene Aktion.** Welche Buchung erlaubt ist, entscheidet der
 *   Server (`GET /scan/:nummer` → `aktionen`). Ein fest ins Template
 *   geschriebenes „Ausgeben" liefe dem Zustandsautomaten davon: Der Benutzer
 *   drückt und erfährt erst danach, dass das Gerät gesperrt ist. Antwortet
 *   der Scan gar nicht, steht auch kein Buchungsknopf da.
 * * **Rechte.** Lesen ist in dieser Anwendung kein Recht — Ändern schon. Ein
 *   Knopf, der zuverlässig 403 liefert, ist eine Zumutung.
 * * **Der Verlauf ist am Computer offen, am Handy eingeklappt.** Das ist eine
 *   Haltungsfrage: Am Schreibtisch sucht man die Historie, auf der Baustelle
 *   den Standort. Beide Richtungen werden geprüft, damit die Handy-Ansicht
 *   nicht nebenbei mitwandert.
 * * **Restfristen in Worten.** „seit 12 Tagen" statt eines Datums, das man
 *   erst gegen den Kalender halten muss.
 *
 * jsdom wertet Medienabfragen nicht aus und meldet immer `false`; die
 * Haltung wird deshalb über `useBreite()` direkt gesetzt.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import GeraetView from "@/views/GeraetView.vue";
import { useBreite } from "@/composables/useBreite";
import { useAnmeldung } from "@/stores/anmeldung";
import type { Buchung, Geraet, Pruefung } from "@/typen";

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
  useRoute: () => ({ params: { id: "g1" }, query: {} }),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const geraet = {
  id: "g1",
  inventarnummer: "10014",
  bezeichnung: "Rüttelplatte Wacker Neuson DPU 6555",
  status: "verfuegbar",
  standort: "Bauhof Nord",
  lagerplatz: "Regal C3",
  nutzer: null,
  hersteller: "Wacker Neuson",
  schlagworte: [],
  zubehoer: [],
  gehoert_zu: null,
  gehoert_zu_id: null,
  titelbild_id: null,
} as unknown as Geraet;

const buchung = {
  id: "b1",
  geraet_id: "g1",
  art: "ruecknahme",
  nach_standort: "Bauhof Nord",
  nach_lagerplatz: "Regal C3",
  empfaenger: null,
  erfasser: "Julius Sima",
  zeitpunkt: "2026-08-27T14:42:00.000Z",
  notiz: null,
} as unknown as Buchung;

/**
 * Ein Datum relativ zu heute, im Format der API (reines Datum als Text).
 *
 * Die Zeitzone der Prüfmaschine wird als nicht-negativ vorausgesetzt —
 * Wien und die Werkbank (UTC) erfüllen das. Eine westliche Zeitzone
 * verschöbe die Tageszählung um eins, weil ein reines Datum als UTC-
 * Mitternacht gelesen wird.
 */
function inTagen(tage: number): string {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pruefung(name: string, faelligInTagen: number): Pruefung {
  return {
    id: `p-${name}`,
    pruefart: name,
    geprueft_am: inTagen(-365),
    naechste_faellig: inTagen(faelligInTagen),
    ergebnis: "bestanden",
    pruefer: null,
    notiz: null,
  };
}

interface Vorgaben {
  breit?: boolean;
  rechte?: string[];
  aktionen?: { art: string; text: string; hauptaktion: boolean }[];
  /** Antwortet `GET /scan/:nummer` überhaupt? */
  scanAntwortet?: boolean;
  historie?: Buchung[];
  pruefungen?: Pruefung[];
}

async function baue(vorgaben: Vorgaben = {}) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = vorgaben.rechte ?? [
    "buchungen.erfassen",
    "geraete.pflegen",
    "schaeden.melden",
    "schaeden.bearbeiten",
  ];

  const { breit } = useBreite();
  breit.value = vorgaben.breit ?? true;

  api.get.mockImplementation(async (pfad: string) => {
    if (pfad.endsWith("/dateien")) return [];
    if (pfad.endsWith("/historie")) return vorgaben.historie ?? [buchung];
    if (pfad.endsWith("/pruefungen")) return vorgaben.pruefungen ?? [];
    if (pfad.endsWith("/schaeden")) return [];
    if (pfad.startsWith("/scan/")) {
      if (vorgaben.scanAntwortet === false) throw new Error("kein Scan");
      return {
        aktionen: vorgaben.aktionen ?? [
          { art: "ausgabe", text: "Ausgeben", hauptaktion: true },
          { art: "umbuchung", text: "Umbuchen", hauptaktion: false },
        ],
      };
    }
    return geraet;
  });

  const ansicht = mount(GeraetView, {
    global: {
      stubs: { RouterLink: true, Kopf: true, Symbol: true, DateiGalerie: true },
    },
  });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return ansicht;
}

/** Die beschrifteten Knöpfe der Ansicht — der Zurück-Winkel trägt keinen Text. */
function knopftexte(ansicht: Awaited<ReturnType<typeof baue>>): string[] {
  return ansicht
    .findAll("button")
    .map((k) => k.text().trim())
    .filter(Boolean);
}

describe("Gerätedetail am Computer", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
  });

  it("trägt die Kopfleiste des Computers statt der Handy-Kopfzeile", async () => {
    const ansicht = await baue({ breit: true });
    expect(ansicht.find(".topleiste").exists()).toBe(true);
    expect(ansicht.find("kopf-stub").exists()).toBe(false);
    // Nummer und Zustand gehören zum Titel, nicht zu den Handlungen.
    expect(ansicht.find(".topleiste").text()).toContain("10014");
    expect(ansicht.find(".topleiste").text()).toContain("Verfügbar");
  });

  it("lässt am Handy alles, wie es war", async () => {
    const ansicht = await baue({ breit: false });
    expect(ansicht.find("kopf-stub").exists()).toBe(true);
    expect(ansicht.find(".topleiste").exists()).toBe(false);
  });

  it("bietet ausschließlich die Buchungen an, die der Server erlaubt", async () => {
    const ansicht = await baue({
      aktionen: [{ art: "ruecknahme", text: "Zurücknehmen", hauptaktion: true }],
    });
    const texte = knopftexte(ansicht);
    expect(texte).toContain("Zurücknehmen");
    // Kein „Ausgeben“, obwohl das Gerät verfügbar ist — der Server hat es
    // nicht angeboten, also gibt es den Knopf nicht.
    expect(texte).not.toContain("Ausgeben");
    expect(texte).not.toContain("Umbuchen");
  });

  it("zeigt gar keine Buchung an, wenn der Scan nicht antwortet", async () => {
    const ansicht = await baue({ scanAntwortet: false });
    const texte = knopftexte(ansicht);
    expect(texte).not.toContain("Ausgeben");
    expect(texte).not.toContain("Umbuchen");
    // Die Ansicht selbst steht trotzdem.
    expect(ansicht.text()).toContain("Regal C3");
  });

  it("hebt die Hauptaktion des Servers als Primärknopf hervor", async () => {
    const ansicht = await baue();
    const haupt = ansicht.findAll("button").find((k) => k.text().trim() === "Ausgeben");
    const neben = ansicht.findAll("button").find((k) => k.text().trim() === "Umbuchen");
    expect(haupt?.classes()).toContain("pt-btn--primaer");
    expect(neben?.classes()).not.toContain("pt-btn--primaer");
  });

  it("blendet Buchungen ohne das Recht buchungen.erfassen aus", async () => {
    const ansicht = await baue({ rechte: ["geraete.pflegen"] });
    const texte = knopftexte(ansicht);
    expect(texte).not.toContain("Ausgeben");
    expect(texte).toContain("Stammdaten bearbeiten");
  });

  it("blendet Stammdaten und Schadensmeldung ohne Recht aus", async () => {
    const ansicht = await baue({ rechte: ["buchungen.erfassen"] });
    const texte = knopftexte(ansicht);
    expect(texte).not.toContain("Stammdaten bearbeiten");
    expect(texte).not.toContain("Schaden melden");
    expect(texte).toContain("Ausgeben");
  });

  it("zeigt den Verlauf am Computer offen — ohne Klick", async () => {
    const ansicht = await baue({ breit: true });
    expect(ansicht.text()).toContain("Zurückgenommen");
    expect(ansicht.text()).toContain("Julius Sima");
    // Kein Aufklapper: Die Haltung entscheidet, nicht eine Einstellung.
    expect(ansicht.find(".aufklapper").exists()).toBe(false);
  });

  it("lässt den Verlauf am Handy eingeklappt", async () => {
    const ansicht = await baue({ breit: false });
    expect(ansicht.find(".aufklapper").exists()).toBe(true);
    expect(ansicht.text()).not.toContain("Zurückgenommen");
  });

  it("nennt den Leerzustand beim Namen", async () => {
    const ansicht = await baue({ historie: [] });
    expect(ansicht.text()).toContain("Noch keine Buchung.");
  });

  it("schreibt Restfristen in Worten und färbt die überfällige rot", async () => {
    const ansicht = await baue({
      pruefungen: [pruefung("Elektro E-Check", -12), pruefung("Sichtprüfung", 31)],
    });

    expect(ansicht.text()).toContain("seit 12 Tagen");
    expect(ansicht.text()).toContain("in 31 Tagen");

    const chips = ansicht.findAll(".pruefzeile .pt-chip");
    expect(chips[0]!.classes()).toContain("pt-chip--defekt");
    expect(chips[1]!.classes()).not.toContain("pt-chip--defekt");
  });

  it("warnt über den Schlagworten, wenn eine Prüfung abgelaufen ist", async () => {
    const ansicht = await baue({ pruefungen: [pruefung("Elektro E-Check", -12)] });
    expect(ansicht.find(".merkmale").text()).toContain(
      "Prüfung überfällig — Elektro E-Check, seit 12 Tagen",
    );
  });
});

/**
 * Dieselben Rechtefragen am Handy.
 *
 * Sie stehen bewusst als eigene Gruppe da: `baue()` setzt `breit` auf `true`,
 * wenn nichts anderes verlangt wird — die Rechte-Tests oben haben den
 * Handy-Zweig deshalb **nie berührt**. Genau dort nahm das `v-for` das rohe
 * Ref statt der geprüften computed, und „Schaden melden" hatte gar kein
 * `v-if`. Beides fiel keinem Test auf, weil keiner hinsah.
 */
describe("Gerätedetail am Handy: Rechte", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
  });

  it("bietet die Buchungen des Servers an, wenn das Recht da ist", async () => {
    const ansicht = await baue({ breit: false, rechte: ["buchungen.erfassen"] });
    const texte = knopftexte(ansicht);
    expect(texte).toContain("Ausgeben");
    expect(texte).toContain("Umbuchen");
  });

  it("blendet die Buchungen ohne buchungen.erfassen aus", async () => {
    const ansicht = await baue({ breit: false, rechte: ["geraete.pflegen"] });
    const texte = knopftexte(ansicht);
    expect(texte).not.toContain("Ausgeben");
    expect(texte).not.toContain("Umbuchen");
    // Die Ansicht selbst bleibt vollständig.
    expect(texte).toContain("Stammdaten bearbeiten");
    expect(ansicht.text()).toContain("Regal C3");
  });

  it("zeigt „Schaden melden“ nur mit schaeden.melden", async () => {
    const mit = await baue({ breit: false, rechte: ["schaeden.melden"] });
    expect(knopftexte(mit)).toContain("Schaden melden");

    // `schaeden.bearbeiten` ist ein anderes Recht (PATCH /schaeden/:id) und
    // reicht zum Melden nicht. Die Rolle „Mitarbeiter“ hat es umgekehrt:
    // melden ja, bearbeiten nein.
    const ohne = await baue({ breit: false, rechte: ["schaeden.bearbeiten"] });
    expect(knopftexte(ohne)).not.toContain("Schaden melden");
  });
});

describe("Gerätedetail am Computer: „Schaden melden“ hängt am richtigen Recht", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
  });

  it("erscheint für die Rolle Mitarbeiter", async () => {
    // Genau der Fall, der vorher nicht ging: Mitarbeiter darf melden, sah
    // den Knopf am Schreibtisch aber nicht, weil dort `schaeden.bearbeiten`
    // geprüft wurde.
    const ansicht = await baue({
      breit: true,
      rechte: ["buchungen.erfassen", "schaeden.melden", "dateien.hochladen"],
    });
    expect(knopftexte(ansicht)).toContain("Schaden melden");
  });

  it("bleibt weg, wenn nur schaeden.bearbeiten da ist", async () => {
    const ansicht = await baue({ breit: true, rechte: ["schaeden.bearbeiten"] });
    expect(knopftexte(ansicht)).not.toContain("Schaden melden");
  });
});
