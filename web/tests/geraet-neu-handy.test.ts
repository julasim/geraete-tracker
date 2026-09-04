/**
 * „Gerät anlegen“ am Handy.
 *
 * Der Handy-Zweig dieser Ansicht ist ein eigener Baum, kein umgestyltes
 * Abbild des Computer-Zweigs: andere Reihenfolge, ein Aufklapper für die
 * selten gebrauchten Felder, ein Knopf statt zweier. Was im einen Zweig
 * stimmt, sagt über den anderen nichts — genau deshalb steht diese Datei
 * neben `geraet-neu-desktop.test.ts`.
 *
 * Geprüft wird, was am Handy anders entschieden ist:
 *
 * * **Der Lagerplatz steht offen**, nicht hinter „Weitere Felder“. Wer am
 *   Handy erfasst, steht im Lager vor dem Regal und ist genau der, der ihn
 *   weiß. Rutschte er hinter den Aufklapper, entstünden reihenweise Geräte
 *   ohne Regal, ohne dass es jemand bemerkt.
 * * **Der Etiketten-Knopf braucht `etiketten.drucken`.** Welches Recht
 *   `/etiketten` verlangt, steht in `rechte-pfade.ts`; ohne das Recht wirft
 *   der Router wortlos auf `/geraete` zurück — schlimmer als ein 403, weil
 *   gar keine Meldung erscheint.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import GeraetNeuView from "@/views/GeraetNeuView.vue";
import { useBreite } from "@/composables/useBreite";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Lagerplatz, Standort } from "@/typen";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const geleitet = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn() }));

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
  useRoute: () => ({ query: {}, params: {} }),
  useRouter: () => geleitet,
}));

function ort(id: string, name: string): Standort {
  return { id, name, typ: "lager", adresse: null, notiz: null, aktiv: true };
}

function platz(id: string, standortId: string, bezeichnung: string): Lagerplatz {
  return {
    id,
    standort_id: standortId,
    bezeichnung,
    barcode: null,
    typ: "regal",
    notiz: null,
    aktiv: true,
  };
}

function angelegtesGeraet(id: string, bezeichnung: string, nummer: string): Geraet {
  return { id, bezeichnung, inventarnummer: nummer, schlagworte: [] } as unknown as Geraet;
}

async function baue(optionen: { rechte?: string[] } = {}) {
  // jsdom wertet keine Medienabfragen aus; die Haltung wird direkt gesetzt.
  const { breit } = useBreite();
  breit.value = false;

  setActivePinia(createPinia());
  const anmeldung = useAnmeldung();
  anmeldung.rechte = optionen.rechte ?? ["geraete.pflegen", "etiketten.drucken"];
  const bestand = useBestand();
  // s2 hat keine Regale — nur an so einem Ort lässt sich prüfen, dass das
  // Auswahlfeld dann gar nicht erst erscheint.
  bestand.standorte = [ort("s1", "Bauhof Nord"), ort("s2", "Container Süd")];
  bestand.lagerplaetze = [platz("p1", "s1", "Regal A1")];
  bestand.schlagworte = [];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  const ansicht = mount(GeraetNeuView, { attachTo: document.body });
  // `onMounted` setzt den Ort erst nach `bestand.laden()`. Ohne einen
  // Durchlauf der Mikrotask-Warteschlange käme diese Zuweisung nach den
  // Eingaben des Tests und der Ortswechsel-Wächter räumte den Platz weg.
  await new Promise((fertig) => setTimeout(fertig, 0));
  await ansicht.vm.$nextTick();
  return { ansicht, bestand, anmeldung };
}

const knopf = (ansicht: ReturnType<typeof mount>, text: string) =>
  ansicht.findAll("button").find((b) => b.text() === text);

describe("Gerät anlegen am Handy", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    geleitet.push.mockReset();
    document.body.innerHTML = "";
  });

  it("zeigt den Lagerplatz offen, nicht hinter „Weitere Felder“", async () => {
    const { ansicht } = await baue();

    // Der Aufklapper ist zu — und der Platz trotzdem da.
    expect(knopf(ansicht, "Weitere Felder")).toBeDefined();
    expect(ansicht.find("#platz").exists()).toBe(true);
    // Gegenprobe innerhalb des Tests: Die Seriennummer liegt sehr wohl
    // dahinter. Fände man auch sie, prüfte die Zusicherung oben nichts.
    expect(ansicht.find("#sn").exists()).toBe(false);
  });

  it("zeigt kein Platz-Feld an einem Ort ohne Regale", async () => {
    // Der Handy-Zweig ist ein eigener Baum — der gleichlautende Test der
    // Computer-Ansicht sagt über ihn nichts aus. Ohne diesen Test blieb der
    // Wächter `v-if="plaetze.length"` hier ungedeckt: Eine Mutation, die ihn
    // entfernt, ließ alle sechzehn Prüfungen grün.
    const { ansicht } = await baue();
    expect(ansicht.find("#platz").exists()).toBe(true);

    await ansicht.find("#ort").setValue("s2");
    expect(ansicht.find("#platz").exists()).toBe(false);

    // Und ohne jeden Ort erst recht nicht.
    await ansicht.find("#ort").setValue("");
    expect(ansicht.find("#platz").exists()).toBe(false);
  });

  it("schickt den gewählten Platz mit hinaus", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Rüttelplatte", "10001"));
    const { ansicht } = await baue();

    await ansicht.find("#ort").setValue("s1");
    await ansicht.find("#platz").setValue("p1");
    await ansicht.find("#bez").setValue("Rüttelplatte");
    await knopf(ansicht, "Anlegen und nächstes")?.trigger("click");
    await ansicht.vm.$nextTick();

    const koerper = api.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(koerper.standort_id).toBe("s1");
    expect(koerper.lagerplatz_id).toBe("p1");
  });

  it("nimmt den Platz des vorigen Ortes nicht mit, wenn der Ort wechselt", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Stampfer", "10002"));
    const { ansicht } = await baue();

    await ansicht.find("#ort").setValue("s1");
    await ansicht.find("#platz").setValue("p1");
    await ansicht.find("#ort").setValue("s2");
    await ansicht.find("#bez").setValue("Stampfer");
    await knopf(ansicht, "Anlegen und nächstes")?.trigger("click");
    await ansicht.vm.$nextTick();

    const koerper = api.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(koerper.standort_id).toBe("s2");
    expect(koerper.lagerplatz_id).toBeNull();
  });

  it("zeigt den Etiketten-Knopf nur mit dem Recht dafür", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Kernbohrer", "10003"));

    const mit = await baue({ rechte: ["geraete.pflegen", "etiketten.drucken"] });
    await mit.ansicht.find("#bez").setValue("Kernbohrer");
    await knopf(mit.ansicht, "Anlegen und nächstes")?.trigger("click");
    await mit.ansicht.vm.$nextTick();
    // Erst mit einem angelegten Gerät gibt es die Rückmeldung überhaupt.
    expect(mit.ansicht.text()).toContain("In dieser Sitzung angelegt");
    expect(mit.ansicht.text()).toContain("Etiketten für diese Geräte drucken");

    const ohne = await baue({ rechte: ["geraete.pflegen"] });
    await ohne.ansicht.find("#bez").setValue("Kernbohrer");
    await knopf(ohne.ansicht, "Anlegen und nächstes")?.trigger("click");
    await ohne.ansicht.vm.$nextTick();
    expect(ohne.ansicht.text()).toContain("In dieser Sitzung angelegt");
    expect(ohne.ansicht.text()).not.toContain("Etiketten für diese Geräte drucken");
  });
});
