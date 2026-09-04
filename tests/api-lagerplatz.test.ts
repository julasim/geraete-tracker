/**
 * Die Regel "ein Regal gehört zu einem Ort" — an allen Stellen, an denen sie
 * greift.
 *
 * Sie stand bis AP25 nur im Buchungsweg und dort nur halb: Fehlte
 * `nach_standort_id`, wurde sie übersprungen. Damit ließ sich ein Gerät, das
 * auf einer Baustelle steht, in ein Regal im Bauhof legen — Ort und Platz
 * widersprachen sich, und nichts meldete es. Diese Datei prüft die geteilte
 * Regel beim Anlegen, beim Einzelbuchen, beim Sammelbuchen und beim
 * Berichtigen.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schliesseDb } from "../src/db/client.js";
import { mitCookie } from "./helpers/konten.js";
import {
  alsAdmin,
  alsMitarbeiter,
  raeumeKontenAuf,
  raeumeTestdatenAuf,
  type Sitzung,
} from "./helpers/stammdaten.js";

let admin: Sitzung;
let mitarbeiter: Sitzung;

/** Bauhof mit Regal, dazu eine Baustelle — die zwei Orte reichen für alles. */
let lagerId: string;
let baustelleId: string;
let regalImLagerId: string;

const FREMDE_ID = "00000000-0000-4000-8000-000000000001";

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();

  lagerId = (await erstelle("/api/standorte", { name: "TEST-LP-Bauhof", typ: "lager" })).id;
  baustelleId = (
    await erstelle("/api/standorte", { name: "TEST-LP-Baustelle", typ: "baustelle" })
  ).id;
  regalImLagerId = (
    await erstelle("/api/lagerplaetze", {
      standort_id: lagerId,
      bezeichnung: "TEST-LP-Regal A1",
    })
  ).id;
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  await schliesseDb();
});

async function sende(pfad: string, sitzung: Sitzung, methode = "GET", koerper?: unknown) {
  const antwort = await mitCookie(pfad, sitzung.cookie, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

async function erstelle(
  pfad: string,
  koerper: unknown,
): Promise<{ id: string; [k: string]: unknown }> {
  const { status, daten } = await sende(pfad, admin, "POST", koerper);
  if (status !== 201) throw new Error(`${pfad}: ${status} — ${JSON.stringify(daten)}`);
  return daten as { id: string };
}

interface Geraet {
  id: string;
  bezeichnung: string;
  inventarnummer: string | null;
  status: string;
  aktueller_standort_id: string | null;
  aktueller_lagerplatz_id: string | null;
}

async function neuesGeraet(zusatz: Record<string, unknown> = {}): Promise<Geraet> {
  return (await erstelle("/api/geraete", {
    bezeichnung: "TEST-LP-Gerät",
    ...zusatz,
  })) as unknown as Geraet;
}

async function hole(id: string): Promise<Geraet> {
  const { daten } = await sende(`/api/geraete/${id}`, admin);
  return daten as Geraet;
}

/** Gibt ein Gerät an einen Ort aus — die Voraussetzung jeder Rücknahme. */
async function ausgeben(geraetId: string, standortId: string) {
  const { status, daten } = await sende("/api/buchungen", mitarbeiter, "POST", {
    geraet_id: geraetId,
    art: "ausgabe",
    nach_standort_id: standortId,
    empfaenger_id: mitarbeiter.konto.id,
  });
  if (status !== 201) throw new Error(`Ausgabe: ${status} — ${JSON.stringify(daten)}`);
}

// ── Anlegen ────────────────────────────────────────────────────────────────

describe("Anlegen mit Ort und Lagerplatz", () => {
  it("schreibt beides direkt ans Gerät", async () => {
    // Kein Übergang, sondern der Anfangswert: Beim Anlegen gibt es keinen
    // Vorzustand, von dem etwas abweichen könnte.
    const geraet = await neuesGeraet({
      bezeichnung: "TEST-LP-MitPlatz",
      standort_id: lagerId,
      lagerplatz_id: regalImLagerId,
    });

    expect(geraet.aktueller_standort_id).toBe(lagerId);
    expect(geraet.aktueller_lagerplatz_id).toBe(regalImLagerId);

    // Und der gespeicherte Stand, nicht nur die Antwort.
    const gelesen = await hole(geraet.id);
    expect(gelesen.aktueller_lagerplatz_id).toBe(regalImLagerId);
  });

  it("weist einen Lagerplatz ab, der zu einem anderen Ort gehört", async () => {
    const { status, daten } = await sende("/api/geraete", admin, "POST", {
      bezeichnung: "TEST-LP-FalscherOrt",
      standort_id: baustelleId,
      lagerplatz_id: regalImLagerId,
    });
    expect(status).toBe(409);
    expect((daten as { grund: string }).grund).toBe("platz_falscher_standort");
  });

  it("weist einen Lagerplatz ohne Ort ab", async () => {
    const { status, daten } = await sende("/api/geraete", admin, "POST", {
      bezeichnung: "TEST-LP-OhneOrt",
      lagerplatz_id: regalImLagerId,
    });
    expect(status).toBe(409);
    expect((daten as { grund: string }).grund).toBe("platz_ohne_standort");
  });

  it("antwortet bei einem unbekannten Lagerplatz mit 404", async () => {
    // Scharf zugesichert: Ein `not.toBe(201)` bliebe auch bei einem 500er
    // grün — und genau der käme ohne die Prüfung heraus, weil der
    // Fremdschlüsselfehler 23503 nirgends übersetzt wird.
    const { status } = await sende("/api/geraete", admin, "POST", {
      bezeichnung: "TEST-LP-UnbekannterPlatz",
      standort_id: lagerId,
      lagerplatz_id: FREMDE_ID,
    });
    expect(status).toBe(404);
  });

  it("antwortet bei einem unbekannten Standort mit 404", async () => {
    const { status } = await sende("/api/geraete", admin, "POST", {
      bezeichnung: "TEST-LP-UnbekannterOrt",
      standort_id: FREMDE_ID,
    });
    expect(status).toBe(404);
  });

  it("legt weiterhin ohne Ort und ohne Platz an", async () => {
    // Der Weg, über den die 200 Maschinen ins System kommen: Der CSV-Import
    // legt bewusst ohne Ort an. Die neue Prüfung darf ihn nicht abwürgen.
    const geraet = await neuesGeraet({ bezeichnung: "TEST-LP-Ortlos" });
    expect(geraet.aktueller_standort_id).toBeNull();
    expect(geraet.aktueller_lagerplatz_id).toBeNull();
  });
});

// ── Einzelbuchung ──────────────────────────────────────────────────────────

describe("Rücknahme ins Regal", () => {
  it("weist ein Regal ab, das zum Ort des Geräts nicht passt", async () => {
    // Die geschlossene Lücke: ohne `nach_standort_id` wurde die Regel früher
    // übersprungen. Das Gerät stünde danach auf der Baustelle — in einem
    // Regal, das im Bauhof steht.
    const geraet = await neuesGeraet({ bezeichnung: "TEST-LP-Luecke" });
    await ausgeben(geraet.id, baustelleId);

    const { status, daten } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ruecknahme",
      nach_lagerplatz_id: regalImLagerId,
    });
    expect(status).toBe(409);
    expect((daten as { grund: string }).grund).toBe("platz_falscher_standort");

    const nachher = await hole(geraet.id);
    expect(nachher.status).toBe("ausgegeben");
    expect(nachher.aktueller_lagerplatz_id).toBeNull();
  });

  it("lässt dieselbe Rücknahme durch, wenn das Regal am Ort des Geräts steht", async () => {
    // Der legitime Fall darf nicht mit abgewürgt werden: Wer ein Gerät im
    // Bauhof ins Regal zurückstellt, gibt den Ort nicht noch einmal an.
    const geraet = await neuesGeraet({ bezeichnung: "TEST-LP-Legitim" });
    await ausgeben(geraet.id, lagerId);

    const { status } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ruecknahme",
      nach_lagerplatz_id: regalImLagerId,
    });
    expect(status).toBe(201);

    const nachher = await hole(geraet.id);
    expect(nachher.status).toBe("verfuegbar");
    expect(nachher.aktueller_standort_id).toBe(lagerId);
    expect(nachher.aktueller_lagerplatz_id).toBe(regalImLagerId);
  });

  it("weist ein Gerät ohne Ort ab, statt ihm einen Platz ohne Ort zu geben", async () => {
    // Erreichbar, weil der Import ohne Ort anlegt und eine Berichtigung den
    // Zustand ohne Ort auf "ausgegeben" setzen kann. Vorher wurde der Platz
    // gesetzt und der Ort blieb leer — schon ein kaputter Bestand.
    const geraet = await neuesGeraet({ bezeichnung: "TEST-LP-Heimatlos" });
    const berichtigt = await sende("/api/buchungen/korrektur", admin, "POST", {
      geraet_id: geraet.id,
      neuer_status: "ausgegeben",
      begruendung: "Stand beim Import schon draußen, Ort ist unbekannt.",
    });
    expect(berichtigt.status).toBe(201);
    expect((await hole(geraet.id)).aktueller_standort_id).toBeNull();

    const { status, daten } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ruecknahme",
      nach_lagerplatz_id: regalImLagerId,
    });
    expect(status).toBe(409);
    expect((daten as { grund: string }).grund).toBe("platz_ohne_standort");
  });
});

// ── Sammelbuchung ──────────────────────────────────────────────────────────

describe("Sammelrücknahme in ein Regal", () => {
  it("bucht keines der Geräte, wenn eines die Platzregel verletzt", async () => {
    // Der Realfall: zwanzig Geräte von verschiedenen Baustellen in EIN Regal,
    // ohne Ortangabe. Vorher entstanden dabei still zwanzig falsche Zeilen.
    const a = await neuesGeraet({ bezeichnung: "TEST-LP-Sammel-Eins" });
    const b = await neuesGeraet({ bezeichnung: "TEST-LP-Sammel-Zwei" });

    // `bucheMehrere` holt die Sperren nach Id sortiert. Damit der Rücklauf
    // etwas beweist, muss das FEHLERHAFTE Gerät hinten liegen — sonst wäre
    // ohnehin nichts gebucht, auch ohne Transaktionsklammer.
    const [zuerst, danach] = [a, b].sort((x, y) => (x.id < y.id ? -1 : 1)) as [Geraet, Geraet];
    await ausgeben(zuerst.id, lagerId); // passt zum Regal
    await ausgeben(danach.id, baustelleId); // passt nicht

    const { status, daten } = await sende("/api/buchungen/sammel", mitarbeiter, "POST", {
      geraet_ids: [a.id, b.id],
      art: "ruecknahme",
      nach_lagerplatz_id: regalImLagerId,
    });

    expect(status).toBe(409);
    const fehler = daten as { error: string; grund: string };
    expect(fehler.grund).toBe("platz_falscher_standort");
    // Die Meldung nennt das Gerät beim Namen — bei zehn Geräten wäre
    // "Der gewählte Lagerplatz gehört zu einem anderen Standort" wertlos.
    expect(fehler.error).toContain(danach.bezeichnung);
    expect(fehler.error).toContain(danach.inventarnummer!);

    // Und das erste Gerät ist unberührt: keine Rücknahme, kein Regal.
    const ersteNachher = await hole(zuerst.id);
    expect(ersteNachher.status).toBe("ausgegeben");
    expect(ersteNachher.aktueller_lagerplatz_id).toBeNull();

    const { daten: verlauf } = await sende(`/api/geraete/${zuerst.id}/historie`, admin);
    expect((verlauf as { art: string }[]).map((z) => z.art)).toEqual(["ausgabe"]);
  });
});

// ── Berichtigen ────────────────────────────────────────────────────────────

describe("Berichtigen und der Lagerplatz", () => {
  /** Ein Gerät, das im Bauhof im Regal steht. */
  async function imRegal(bezeichnung: string): Promise<Geraet> {
    const geraet = await neuesGeraet({ bezeichnung });
    await ausgeben(geraet.id, lagerId);
    const { status } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ruecknahme",
      nach_lagerplatz_id: regalImLagerId,
    });
    expect(status).toBe(201);
    const stand = await hole(geraet.id);
    expect(stand.aktueller_lagerplatz_id).toBe(regalImLagerId);
    return stand;
  }

  it("behält den Lagerplatz, wenn der Ort gleich bleibt", async () => {
    // Der wichtigere der beiden Tests: Eine falsch formulierte Bedingung
    // löschte den Lagerplatz bei JEDER Korrektur — Datenverlust, der erst
    // auffiele, wenn jemand ein Regal sucht.
    const geraet = await imRegal("TEST-LP-Korr-Bleibt");

    const { status } = await sende("/api/buchungen/korrektur", admin, "POST", {
      geraet_id: geraet.id,
      neuer_status: "wartung",
      begruendung: "Steht seit gestern in der Werkstatt, Zustand war falsch.",
    });
    expect(status).toBe(201);

    const nachher = await hole(geraet.id);
    expect(nachher.aktueller_standort_id).toBe(lagerId);
    expect(nachher.aktueller_lagerplatz_id).toBe(regalImLagerId);
  });

  it("setzt den Lagerplatz auf leer, wenn der Ort wechselt", async () => {
    // Sonst hinge am Gerät ein Regal des alten Orts — genau der Widerspruch,
    // den die Platzregel beim Buchen verhindert.
    const geraet = await imRegal("TEST-LP-Korr-Wechsel");

    const { status } = await sende("/api/buchungen/korrektur", admin, "POST", {
      geraet_id: geraet.id,
      neuer_status: "verfuegbar",
      nach_standort_id: baustelleId,
      begruendung: "Gerät steht in Wahrheit auf der Baustelle, nicht im Bauhof.",
    });
    expect(status).toBe(201);

    const nachher = await hole(geraet.id);
    expect(nachher.aktueller_standort_id).toBe(baustelleId);
    expect(nachher.aktueller_lagerplatz_id).toBeNull();
  });
});
