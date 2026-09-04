/**
 * „Gerät anlegen“ am Computer.
 *
 * Diese Ansicht wird nicht einmal benutzt, sondern eine Stunde am Stück:
 * Wer 200 Maschinen aufnimmt, drückt 200 Mal „Anlegen und nächstes“. Alles,
 * was dabei nur *fast* stimmt, kostet 200 Mal Zeit. Geprüft wird deshalb
 * genau das, was dabei still kippen kann:
 *
 * * **Ort, Lagerplatz und Schlagworte müssen stehen bleiben.** Werden sie
 *   mitgeleert, merkt das keine Typprüfung — es fällt erst am zwanzigsten
 *   Gerät auf, und dann hat jemand zwanzig Geräte am falschen Ort.
 * * **Der Lagerplatz muss zum Ort passen.** Wechselt der Ort, ist das Regal
 *   des vorigen Ortes ungültig; ginge es trotzdem mit hinaus, antwortete der
 *   Server mit 409, während im Formular alles richtig aussieht. Das ist der
 *   teuerste Fehler dieser Ansicht, weil er unsichtbar ist.
 * * **Die Notiz muss es weiterhin geben.** Sie stand vor dem Lagerplatz an
 *   dessen Stelle; verschwindet sie beim Umbau, meldet das keine Typprüfung.
 * * **Die Inventarnummer vergibt der Server.** Käme hier je eine gerechnete
 *   Nummer heraus, klebte sie irgendwann zum zweiten Mal (AP12).
 * * **Bei einem Fehler darf nichts geleert werden**, sonst tippt man alles
 *   noch einmal.
 * * **Kopf und TopLeiste nie gleichzeitig** — zwei Überschriften
 *   übereinander sind der sichtbarste Umbruchpunkt-Fehler.
 * * Der Etiketten-Knopf muss **alle** Geräte der Sitzung übergeben, auch
 *   die, die in der verkürzten Liste nicht mehr stehen.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import GeraetNeuView from "@/views/GeraetNeuView.vue";
import Kopf from "@/components/Kopf.vue";
import TopLeiste from "@/components/TopLeiste.vue";
import { useBreite } from "@/composables/useBreite";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Lagerplatz, Schlagwort, Standort } from "@/typen";

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

function wort(id: string, name: string): Schlagwort {
  return { id, name, farbe: null };
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

/** Was der Server auf ein angelegtes Gerät antwortet — Nummer inklusive. */
function angelegtesGeraet(id: string, bezeichnung: string, nummer: string): Geraet {
  return { id, bezeichnung, inventarnummer: nummer, schlagworte: [] } as unknown as Geraet;
}

async function baue(optionen: { breit?: boolean; rechte?: string[] } = {}) {
  const { breit } = useBreite();
  breit.value = optionen.breit ?? true;

  setActivePinia(createPinia());
  const anmeldung = useAnmeldung();
  anmeldung.rechte = optionen.rechte ?? [
    "geraete.pflegen",
    "etiketten.drucken",
    "daten.austauschen",
  ];
  const bestand = useBestand();
  bestand.standorte = [ort("s1", "Bauhof Nord"), ort("s2", "Werkstatt"), ort("s3", "Container Süd")];
  // s3 bekommt bewusst keinen Platz: Ein Ort ohne Regale ist der Normalfall,
  // und nur an ihm lässt sich prüfen, dass das Auswahlfeld dann fehlt.
  bestand.lagerplaetze = [platz("p1", "s1", "Regal A1"), platz("p2", "s2", "Regal B1")];
  bestand.schlagworte = [wort("w1", "Elektro"), wort("w2", "Benzin")];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  const ansicht = mount(GeraetNeuView, { attachTo: document.body });
  // `onMounted` wartet auf `bestand.laden()` und setzt DANACH den Ort. Ohne
  // einen Durchlauf der Mikrotask-Warteschlange liefe diese Zuweisung nach den
  // Eingaben des Tests — und der Ortswechsel-Wächter räumte den Platz gleich
  // wieder weg. Der Test prüfte dann nicht mehr, was er soll.
  await new Promise((fertig) => setTimeout(fertig, 0));
  await ansicht.vm.$nextTick();
  return { ansicht, bestand, anmeldung };
}

const knopf = (ansicht: ReturnType<typeof mount>, text: string) =>
  ansicht.findAll("button").find((b) => b.text() === text);

/** Ein Gerät erfassen: Bezeichnung eintippen, „Anlegen und nächstes“. */
async function erfasse(ansicht: ReturnType<typeof mount>, bezeichnung: string) {
  await ansicht.find("#bez").setValue(bezeichnung);
  await knopf(ansicht, "Anlegen und nächstes")?.trigger("click");
  await ansicht.vm.$nextTick();
}

describe("Gerät anlegen am Computer", () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    geleitet.push.mockReset();
    geleitet.back.mockReset();
    document.body.innerHTML = "";
  });

  it("trägt am Computer die TopLeiste und am Handy den Kopf — nie beides", async () => {
    const computer = await baue({ breit: true });
    expect(computer.ansicht.findComponent(TopLeiste).exists()).toBe(true);
    expect(computer.ansicht.findComponent(Kopf).exists()).toBe(false);

    const handy = await baue({ breit: false });
    expect(handy.ansicht.findComponent(Kopf).exists()).toBe(true);
    expect(handy.ansicht.findComponent(TopLeiste).exists()).toBe(false);
  });

  it("lässt Ort, Lagerplatz und Schlagworte stehen und leert nur das Gerät", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Rüttelplatte", "10001"));
    const { ansicht } = await baue();

    // Ort umstellen, Regal wählen, ein Schlagwort setzen — alles drei gehört
    // zur Umgebung und soll die Runde überleben. Der Ort zuerst: Er räumt den
    // Platz weg, wäre also nach ihm gesetzt worden umsonst.
    await ansicht.find("#ort").setValue("s2");
    await ansicht.find("#platz").setValue("p2");
    await knopf(ansicht, "Elektro")?.trigger("click");

    await ansicht.find("#bez").setValue("Rüttelplatte");
    await ansicht.find("#herst").setValue("Wacker Neuson");
    await ansicht.find("#mod").setValue("BS 60-4s");
    await ansicht.find("#sn").setValue("SN-4711");

    // Fokus bewusst wegnehmen: Beim Öffnen steht er schon in der
    // Bezeichnung — ohne diesen Schritt würde der Test den Rücksprung gar
    // nicht prüfen, sondern nur, dass ihn niemand weggenommen hat.
    (ansicht.find("#sn").element as HTMLInputElement).focus();

    await knopf(ansicht, "Anlegen und nächstes")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post).toHaveBeenCalledWith(
      "/geraete",
      expect.objectContaining({
        bezeichnung: "Rüttelplatte",
        hersteller: "Wacker Neuson",
        standort_id: "s2",
        lagerplatz_id: "p2",
        schlagworte: ["w1"],
      }),
    );

    // Das Gerät ist weg, die Umgebung bleibt.
    expect((ansicht.find("#bez").element as HTMLInputElement).value).toBe("");
    expect((ansicht.find("#herst").element as HTMLInputElement).value).toBe("");
    expect((ansicht.find("#mod").element as HTMLInputElement).value).toBe("");
    expect((ansicht.find("#sn").element as HTMLInputElement).value).toBe("");
    expect((ansicht.find("#ort").element as HTMLSelectElement).value).toBe("s2");
    expect((ansicht.find("#platz").element as HTMLSelectElement).value).toBe("p2");
    expect(knopf(ansicht, "Elektro")?.attributes("aria-pressed")).toBe("true");

    // Und der Fokus steht wieder da, wo das nächste Gerät anfängt.
    expect(document.activeElement).toBe(ansicht.find("#bez").element);
  });

  it("schickt Ort und Lagerplatz zusammen hinaus", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Bohrhammer", "10004"));
    const { ansicht } = await baue();

    await ansicht.find("#ort").setValue("s1");
    await ansicht.find("#platz").setValue("p1");
    await erfasse(ansicht, "Bohrhammer");

    const koerper = api.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(koerper.standort_id).toBe("s1");
    expect(koerper.lagerplatz_id).toBe("p1");
  });

  it("nimmt den Platz des vorigen Ortes nicht mit, wenn der Ort wechselt", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Trennschleifer", "10005"));
    const { ansicht } = await baue();

    await ansicht.find("#ort").setValue("s1");
    await ansicht.find("#platz").setValue("p1");
    // Der neue Ort hat selbst Regale — sonst verschwände das Auswahlfeld und
    // der Test bewiese nur das, statt den Wächter auf `standortId`.
    await ansicht.find("#ort").setValue("s2");

    // Sichtbar ist das Feld leer. Das allein belegt die Regel NICHT: Steht
    // der Wert nicht mehr in den Optionen, zeigt ein Select ohnehin nichts an,
    // ganz gleich was der Ref noch hält. Belegt wird sie unten am Körper des
    // Aufrufs — und zusätzlich hier daran, dass „p1“ gar nicht mehr angeboten
    // wird.
    expect((ansicht.find("#platz").element as HTMLSelectElement).value).toBe("");
    expect(ansicht.findAll("#platz option").map((o) => o.attributes("value"))).not.toContain("p1");

    await erfasse(ansicht, "Trennschleifer");

    // … und genauso geht es hinaus. Bliebe „p1“ stehen, antwortete der Server
    // mit 409 (platz_falscher_standort), obwohl das Formular richtig aussieht.
    const koerper = api.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(koerper.standort_id).toBe("s2");
    expect(koerper.lagerplatz_id).toBeNull();
  });

  it("zeigt kein Platz-Feld an einem Ort ohne Regale", async () => {
    const { ansicht } = await baue();

    await ansicht.find("#ort").setValue("s1");
    expect(ansicht.find("#platz").exists()).toBe(true);

    await ansicht.find("#ort").setValue("s3");
    expect(ansicht.find("#platz").exists()).toBe(false);

    // Auch ohne Ort: „— kein bestimmter Platz —“ allein ist kein Auswahlfeld.
    await ansicht.find("#ort").setValue("");
    expect(ansicht.find("#platz").exists()).toBe(false);
  });

  it("hat weiterhin ein Notizfeld", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Kompressor", "10006"));
    const { ansicht } = await baue();

    expect(ansicht.find("#notiz").exists()).toBe(true);
    await ansicht.find("#notiz").setValue("Schlüssel liegt im Büro");
    await erfasse(ansicht, "Kompressor");

    const koerper = api.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(koerper.notiz).toBe("Schlüssel liegt im Büro");
  });

  it("erfindet keine Inventarnummer, sondern überlässt sie dem Server", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Stampfer", "10002"));
    const { ansicht } = await baue();

    await erfasse(ansicht, "Stampfer");

    const koerper = api.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(koerper.inventarnummer).toBeNull();
    // Die Nummer kommt aus der Antwort, nicht aus dem Formular.
    expect(ansicht.text()).toContain("10002");
  });

  it("legt ohne Bezeichnung nichts an", async () => {
    const { ansicht } = await baue();

    expect(knopf(ansicht, "Anlegen und nächstes")?.attributes("disabled")).toBeDefined();
    expect(knopf(ansicht, "Anlegen und schließen")?.attributes("disabled")).toBeDefined();

    await ansicht.find("#herst").setValue("Hilti");
    await knopf(ansicht, "Anlegen und nächstes")?.trigger("click");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("legt bei „Anlegen und schließen“ genau einmal an und verlässt die Erfassung", async () => {
    api.post.mockResolvedValue(angelegtesGeraet("g1", "Kernbohrer", "10003"));
    const { ansicht } = await baue();

    await ansicht.find("#bez").setValue("Kernbohrer");
    await knopf(ansicht, "Anlegen und schließen")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(geleitet.push).toHaveBeenCalledWith("/geraete");
  });

  it("zeigt den Serverwortlaut und lässt die Eingaben stehen", async () => {
    const { ApiError } = await import("@/api");
    api.post.mockRejectedValue(new ApiError(409, "Die Nummer 10114 ist bereits vergeben."));
    const { ansicht } = await baue();

    await ansicht.find("#bez").setValue("Tauchpumpe");
    await ansicht.find("#inv").setValue("10114");
    await knopf(ansicht, "Anlegen und nächstes")?.trigger("click");
    await ansicht.vm.$nextTick();

    expect(ansicht.text()).toContain("Die Nummer 10114 ist bereits vergeben.");
    // Nichts geleert: Wer sich vertippt hat, korrigiert eine Zeile statt alles.
    expect((ansicht.find("#bez").element as HTMLInputElement).value).toBe("Tauchpumpe");
    expect((ansicht.find("#inv").element as HTMLInputElement).value).toBe("10114");
  });

  it("übergibt dem Etikettendruck alle Geräte der Sitzung, nicht nur die sichtbaren", async () => {
    const { ansicht } = await baue();

    for (let i = 1; i <= 12; i++) {
      api.post.mockResolvedValue(angelegtesGeraet(`g${i}`, `Gerät ${i}`, `1000${i}`));
      await erfasse(ansicht, `Gerät ${i}`);
    }

    // Die Liste kürzt auf zehn — und sagt das auch.
    expect(ansicht.text()).toContain("und 2 weitere in dieser Sitzung");

    await knopf(ansicht, "Etiketten für diese Geräte drucken")?.trigger("click");

    const ziel = geleitet.push.mock.calls.at(-1)![0] as { path: string; query: { geraete: string } };
    expect(ziel.path).toBe("/etiketten");
    expect(ziel.query.geraete.split(",")).toHaveLength(12);
    expect(ziel.query.geraete.split(",")).toContain("g1");
  });

  it("zeigt Etikettendruck und Excel-Weg nur mit dem passenden Recht", async () => {
    const ohne = await baue({ rechte: ["geraete.pflegen"] });
    expect(ohne.ansicht.text()).not.toContain("Etiketten für diese Geräte drucken");
    expect(ohne.ansicht.text()).not.toContain("Zu Import und Export");

    const mit = await baue({ rechte: ["geraete.pflegen", "etiketten.drucken"] });
    expect(mit.ansicht.text()).toContain("Etiketten für diese Geräte drucken");
    expect(mit.ansicht.text()).not.toContain("Zu Import und Export");
  });
});
