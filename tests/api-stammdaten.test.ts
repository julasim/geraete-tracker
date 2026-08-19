/**
 * Schlagworte, Standorte, Lagerplätze — anlegen, ändern, Rechte.
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

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  await schliesseDb();
});

async function sende(pfad: string, sitzung: Sitzung, methode: string, koerper?: unknown) {
  const antwort = await mitCookie(pfad, sitzung.cookie, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

describe("Schlagworte", () => {
  it("beginnt leer — es wird nichts vorgegeben", async () => {
    const { status, daten } = await sende("/api/schlagworte", mitarbeiter, "GET");
    expect(status).toBe(200);
    expect(Array.isArray(daten)).toBe(true);
  });

  it("lässt die Verwaltung eigene Schlagworte anlegen", async () => {
    const { status, daten } = await sende("/api/schlagworte", admin, "POST", {
      name: "TEST-Bagger",
      farbe: "#b91c1c",
    });
    expect(status).toBe(201);
    expect((daten as { name: string }).name).toBe("TEST-Bagger");
  });

  it("lehnt ein doppeltes Schlagwort ab, auch in anderer Schreibweise", async () => {
    await sende("/api/schlagworte", admin, "POST", { name: "TEST-Kran" });
    const zweiter = await sende("/api/schlagworte", admin, "POST", { name: "test-kran" });
    expect(zweiter.status).toBe(409);
  });

  it("lässt Mitarbeiter lesen, aber nicht anlegen", async () => {
    expect((await sende("/api/schlagworte", mitarbeiter, "GET")).status).toBe(200);
    const versuch = await sende("/api/schlagworte", mitarbeiter, "POST", { name: "TEST-verboten" });
    expect(versuch.status).toBe(403);
  });
});

describe("Standorte", () => {
  it("hat den Lager-Standort aus den Startdaten", async () => {
    const { daten } = await sende("/api/standorte", mitarbeiter, "GET");
    const lager = (daten as { typ: string }[]).filter((s) => s.typ === "lager");
    expect(lager.length).toBeGreaterThanOrEqual(1);
  });

  it("legt eine Baustelle an", async () => {
    const { status, daten } = await sende("/api/standorte", admin, "POST", {
      name: "TEST-Baustelle Lindengasse",
      typ: "baustelle",
      adresse: "Lindengasse 1, 1070 Wien",
    });
    expect(status).toBe(201);
    expect((daten as { typ: string }).typ).toBe("baustelle");
  });

  it("lehnt einen zweiten aktiven Standort gleichen Namens ab", async () => {
    await sende("/api/standorte", admin, "POST", { name: "TEST-Doppelt", typ: "baustelle" });
    const zweiter = await sende("/api/standorte", admin, "POST", {
      name: "TEST-doppelt",
      typ: "baustelle",
    });
    expect(zweiter.status).toBe(409);
  });

  it("erlaubt denselben Namen wieder, sobald der alte stillgelegt ist", async () => {
    // Eine abgeschlossene Baustelle darf Jahre später neu entstehen.
    const erster = await sende("/api/standorte", admin, "POST", {
      name: "TEST-Wiederverwendet",
      typ: "baustelle",
    });
    const id = (erster.daten as { id: string }).id;
    await sende(`/api/standorte/${id}`, admin, "PATCH", { aktiv: false });

    const zweiter = await sende("/api/standorte", admin, "POST", {
      name: "TEST-Wiederverwendet",
      typ: "baustelle",
    });
    expect(zweiter.status).toBe(201);
  });

  it("weist eine unbrauchbare ID mit 400 ab, nicht mit einem Serverfehler", async () => {
    const { status } = await sende("/api/standorte/keine-uuid", mitarbeiter, "GET");
    expect(status).toBe(400);
  });

  it("meldet 404 für einen Standort, den es nicht gibt", async () => {
    const { status } = await sende(
      "/api/standorte/00000000-0000-0000-0000-000000000000",
      mitarbeiter,
      "GET",
    );
    expect(status).toBe(404);
  });
});

describe("Lagerplätze", () => {
  let standortId: string;

  beforeAll(async () => {
    const { daten } = await sende("/api/standorte", admin, "POST", {
      name: "TEST-Bauhof",
      typ: "lager",
    });
    standortId = (daten as { id: string }).id;
  });

  it("vergibt von selbst die nächste freie Kennung mit P-Präfix", async () => {
    const { status, daten } = await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-Regal C3",
      typ: "regal",
    });
    expect(status).toBe(201);
    expect((daten as { barcode: string }).barcode).toMatch(/^P-\d{4}$/);
  });

  it("zählt die Kennungen fortlaufend weiter", async () => {
    const a = await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-Regal D1",
    });
    const b = await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-Regal D2",
    });
    const erste = (a.daten as { barcode: string }).barcode;
    const zweite = (b.daten as { barcode: string }).barcode;
    expect(zweite).not.toBe(erste);
    expect(Number(zweite.slice(2))).toBe(Number(erste.slice(2)) + 1);
  });

  it("lehnt einen Platz-Code ohne P-Präfix ab", async () => {
    // Genau das hält Regale von Gerätenummern getrennt.
    const { status, daten } = await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-Falscher Code",
      barcode: "10042",
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toContain("P-");
  });

  it("ergänzt einen fehlenden Bindestrich bei getippter Eingabe", async () => {
    const { status, daten } = await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-Ohne Bindestrich",
      barcode: "P9911",
    });
    expect(status).toBe(201);
    expect((daten as { barcode: string }).barcode).toBe("P-9911");
  });

  it("lehnt einen bereits vergebenen Code ab", async () => {
    await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-Erster",
      barcode: "P-7777",
    });
    const zweiter = await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-Zweiter",
      barcode: "P-7777",
    });
    expect(zweiter.status).toBe(409);
  });

  it("lässt Mitarbeiter lesen, aber keinen Platz anlegen", async () => {
    expect((await sende("/api/lagerplaetze", mitarbeiter, "GET")).status).toBe(200);
    const versuch = await sende("/api/lagerplaetze", mitarbeiter, "POST", {
      standort_id: standortId,
      bezeichnung: "TEST-verboten",
    });
    expect(versuch.status).toBe(403);
  });

  it("meldet einen Standort, den es nicht gibt, mit 404", async () => {
    const { status } = await sende("/api/lagerplaetze", admin, "POST", {
      standort_id: "00000000-0000-0000-0000-000000000000",
      bezeichnung: "TEST-Nirgendwo",
    });
    expect(status).toBe(404);
  });
});
