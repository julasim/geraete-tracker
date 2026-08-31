/**
 * Pakete — benannte Zusammenstellungen für die Sammelbuchung.
 *
 * Für eine Estrich-Baustelle fahren immer dieselben acht Geräte mit.
 *
 * Der Kern, den diese Datei festhält: **Ein Paket hält keinen Bestand.** Es
 * zeigt nur auf Geräte; wo etwas steht, sagt allein das Gerät. Deshalb darf
 * ein Gerät in mehreren Paketen stecken, und deshalb darf ein Paket — anders
 * als ein Standort — wirklich gelöscht werden: Es taucht in keiner Historie
 * auf.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/api/server.js";
import { db, schliesseDb } from "../src/db/client.js";
import { alsAdmin, alsMitarbeiter, raeumeKontenAuf, type Sitzung } from "./helpers/stammdaten.js";

const MARKE = "PAKET-TEST";
let admin: Sitzung;
let mitarbeiter: Sitzung;
const geraete: string[] = [];

async function sende(pfad: string, sitzung: Sitzung, methode: string, koerper?: unknown) {
  const antwort = await app.request(pfad, {
    method: methode,
    headers: { Cookie: sitzung.cookie, "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  const typ = antwort.headers.get("content-type") ?? "";
  return {
    status: antwort.status,
    daten: typ.includes("json") ? await antwort.json().catch(() => null) : null,
  };
}

async function neuesGeraet(nummer: string): Promise<string> {
  const [g] = await db()<{ id: string }[]>`
    INSERT INTO geraete (inventarnummer, bezeichnung)
    VALUES (${nummer}, ${`${MARKE} ${nummer}`}) RETURNING id`;
  geraete.push(g!.id);
  return g!.id;
}

beforeAll(async () => {
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();
}, 120_000);

afterAll(async () => {
  await db()`DELETE FROM pakete WHERE name LIKE ${MARKE + "%"}`;
  await db()`DELETE FROM etikettennummern WHERE geraet_id = ANY(${geraete})`;
  await db()`DELETE FROM geraete_barcodes WHERE geraet_id = ANY(${geraete})`;
  await db()`DELETE FROM geraete WHERE id = ANY(${geraete})`;
  await raeumeKontenAuf();
  await schliesseDb();
});

describe("Pakete", () => {
  it("legt ein Paket mit Geräten an und gibt sie in Reihenfolge zurück", async () => {
    const a = await neuesGeraet("80001");
    const b = await neuesGeraet("80002");

    const { status, daten } = await sende("/api/pakete", admin, "POST", {
      name: `${MARKE} Estrich`,
      notiz: "Fährt immer zusammen",
      geraet_ids: [b, a], // bewusst verdreht
    });
    expect(status).toBe(201);
    expect((daten as { anzahl: number }).anzahl).toBe(2);

    const id = (daten as { id: string }).id;
    const inhalt = await sende(`/api/pakete/${id}/geraete`, admin, "GET");
    // Die Reihenfolge der Eingabe bleibt erhalten — wer ein Paket
    // zusammenstellt, ordnet es meist so, wie geladen wird.
    expect((inhalt.daten as { id: string }[]).map((g) => g.id)).toEqual([b, a]);
  }, 60_000);

  it("lässt dasselbe Gerät in mehreren Paketen zu", async () => {
    const geteilt = await neuesGeraet("80011");
    const eins = await sende("/api/pakete", admin, "POST", {
      name: `${MARKE} Erdbau`,
      geraet_ids: [geteilt],
    });
    const zwei = await sende("/api/pakete", admin, "POST", {
      name: `${MARKE} Vermessung`,
      geraet_ids: [geteilt],
    });
    // Die Rüttelplatte gehört zum Estrich-Set UND zum Erdbau-Set. Sie
    // deshalb doppelt zu führen, wäre unsinnig.
    expect(eins.status).toBe(201);
    expect(zwei.status).toBe(201);
  }, 60_000);

  it("weist einen doppelten Namen unter den aktiven ab", async () => {
    await sende("/api/pakete", admin, "POST", { name: `${MARKE} Doppelt` });
    const zweiter = await sende("/api/pakete", admin, "POST", { name: `${MARKE} doppelt` });
    // Groß- und Kleinschreibung darf nicht als Unterschied durchgehen.
    expect(zweiter.status).toBeGreaterThanOrEqual(400);
  }, 60_000);

  it("gibt den Namen wieder frei, wenn das Paket stillgelegt wird", async () => {
    const erster = await sende("/api/pakete", admin, "POST", { name: `${MARKE} Saison` });
    const id = (erster.daten as { id: string }).id;
    await sende(`/api/pakete/${id}`, admin, "PATCH", { aktiv: false });

    const zweiter = await sende("/api/pakete", admin, "POST", { name: `${MARKE} Saison` });
    expect(zweiter.status).toBe(201);
  }, 60_000);

  it("ersetzt die Geräteliste, statt sie zu ergänzen", async () => {
    const a = await neuesGeraet("80021");
    const b = await neuesGeraet("80022");
    const angelegt = await sende("/api/pakete", admin, "POST", {
      name: `${MARKE} Wechsel`,
      geraet_ids: [a, b],
    });
    const id = (angelegt.daten as { id: string }).id;

    const geaendert = await sende(`/api/pakete/${id}`, admin, "PATCH", { geraet_ids: [a] });
    expect((geaendert.daten as { anzahl: number }).anzahl).toBe(1);
  }, 60_000);

  it("weist ein erfundenes Gerät ab", async () => {
    const { status } = await sende("/api/pakete", admin, "POST", {
      name: `${MARKE} Erfunden`,
      geraet_ids: ["11111111-1111-4111-8111-111111111111"],
    });
    expect(status).toBe(404);
  });

  it("löscht ein Paket samt Zuordnungen — die Geräte bleiben", async () => {
    const a = await neuesGeraet("80031");
    const angelegt = await sende("/api/pakete", admin, "POST", {
      name: `${MARKE} Vergänglich`,
      geraet_ids: [a],
    });
    const id = (angelegt.daten as { id: string }).id;

    const { status } = await sende(`/api/pakete/${id}`, admin, "DELETE");
    expect(status).toBe(204);

    const [z] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM paket_geraete WHERE paket_id = ${id}`;
    expect(z?.n).toBe(0);

    // Das Gerät ist unversehrt — ein Paket hält keinen Bestand.
    const [g] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM geraete WHERE id = ${a}`;
    expect(g?.n).toBe(1);
  }, 60_000);

  it("nimmt ein gelöschtes Gerät aus allen Paketen", async () => {
    const fluechtig = await neuesGeraet("80041");
    const angelegt = await sende("/api/pakete", admin, "POST", {
      name: `${MARKE} Mit Abgang`,
      geraet_ids: [fluechtig],
    });
    const id = (angelegt.daten as { id: string }).id;

    await db()`DELETE FROM etikettennummern WHERE geraet_id = ${fluechtig}`;
    await db()`DELETE FROM geraete_barcodes WHERE geraet_id = ${fluechtig}`;
    await db()`DELETE FROM geraete WHERE id = ${fluechtig}`;

    // Kein Karteileichen-Eintrag: Das Paket zeigt danach auf nichts mehr.
    const inhalt = await sende(`/api/pakete/${id}/geraete`, admin, "GET");
    expect(inhalt.daten).toHaveLength(0);
  }, 60_000);

  it("lesen darf jeder, ändern nur mit stammdaten.pflegen", async () => {
    const lesen = await sende("/api/pakete", mitarbeiter, "GET");
    expect(lesen.status).toBe(200);

    const anlegen = await sende("/api/pakete", mitarbeiter, "POST", { name: `${MARKE} Verboten` });
    expect(anlegen.status).toBe(403);
  }, 60_000);
});
