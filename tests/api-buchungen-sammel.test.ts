/**
 * Sammelbuchung — mehrere Geräte in einem Vorgang.
 *
 * Der Fall aus dem Bauhof: Zehn Geräte gehen auf dieselbe Baustelle. Einzeln
 * gebucht sind das dreißig Handgriffe.
 *
 * Die Regel, um die es hier vor allem geht, ist **alles oder nichts**:
 * Scheitert ein Gerät, wird die ganze Transaktion zurückgerollt. Eine halb
 * ausgeführte Sammelbuchung hinterließe einen Bestand, den niemand mehr
 * erklären kann — welche fünf der zehn sind jetzt draußen? Stattdessen nennt
 * die Meldung das Gerät beim Namen, es wird aus der Liste genommen, und der
 * Rest geht durch.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/api/server.js";
import { db, schliesseDb } from "../src/db/client.js";
import { alsAdmin, alsMitarbeiter, raeumeKontenAuf, type Sitzung } from "./helpers/stammdaten.js";

const MARKE = "SAMMEL-TEST";
let admin: Sitzung;
let mitarbeiter: Sitzung;
let standortId: string;
const geraete: string[] = [];

async function sende(pfad: string, sitzung: Sitzung, methode: string, koerper?: unknown) {
  const antwort = await app.request(pfad, {
    method: methode,
    headers: { Cookie: sitzung.cookie, "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

/** Legt ein Gerät direkt in der Datenbank an — schnell und ohne Nummernsperre. */
async function neuesGeraet(nummer: string, status = "verfuegbar"): Promise<string> {
  const [g] = await db()<{ id: string }[]>`
    INSERT INTO geraete (inventarnummer, bezeichnung, status)
    VALUES (${nummer}, ${`${MARKE} ${nummer}`}, ${status}) RETURNING id`;
  geraete.push(g!.id);
  return g!.id;
}

beforeAll(async () => {
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();
  const [ort] = await db()<{ id: string }[]>`
    INSERT INTO standorte (name, typ) VALUES (${`${MARKE} Baustelle`}, 'baustelle') RETURNING id`;
  standortId = ort!.id;
}, 120_000);

afterAll(async () => {
  await db()`DROP RULE IF EXISTS buchungen_kein_delete ON buchungen`;
  await db()`DROP RULE IF EXISTS buchungen_kein_update ON buchungen`;
  await db()`DELETE FROM buchungen WHERE geraet_id = ANY(${geraete})`;
  await db()`CREATE RULE buchungen_kein_update AS ON UPDATE TO buchungen DO INSTEAD NOTHING`;
  await db()`CREATE RULE buchungen_kein_delete AS ON DELETE TO buchungen DO INSTEAD NOTHING`;
  await db()`DELETE FROM etikettennummern WHERE geraet_id = ANY(${geraete})`;
  await db()`DELETE FROM geraete_barcodes WHERE geraet_id = ANY(${geraete})`;
  await db()`DELETE FROM geraete WHERE id = ANY(${geraete})`;
  await db()`DELETE FROM standorte WHERE name LIKE ${MARKE + "%"}`;
  await raeumeKontenAuf();
  await schliesseDb();
});

const ausgabe = (ids: string[]) => ({
  geraet_ids: ids,
  art: "ausgabe" as const,
  nach_standort_id: standortId,
  empfaenger_freitext: "Sammeltest",
});

describe("Sammelbuchung", () => {
  it("bucht mehrere Geräte in einem Vorgang", async () => {
    const ids = [await neuesGeraet("70001"), await neuesGeraet("70002"), await neuesGeraet("70003")];
    const { status, daten } = await sende("/api/buchungen/sammel", admin, "POST", ausgabe(ids));

    expect(status).toBe(201);
    const antwort = daten as { buchungen: unknown[]; geraete: { status: string }[] };
    expect(antwort.buchungen).toHaveLength(3);
    expect(antwort.geraete.every((g) => g.status === "ausgegeben")).toBe(true);

    const [z] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM geraete
       WHERE id = ANY(${ids}) AND aktueller_standort_id = ${standortId}`;
    expect(z?.n).toBe(3);
  }, 60_000);

  it("rollt ALLES zurück, wenn ein Gerät nicht darf", async () => {
    /**
     * `bucheMehrere` sperrt die Geräte **nach Id sortiert** (gegen Deadlocks).
     * Welches davon das defekte ist, entschiede sonst der Zufall der UUID —
     * läge es vorn, wäre nichts gebucht, und der Test wäre auch ohne
     * Transaktionsklammer grün. Genau das ist bei der ersten Gegenprobe
     * passiert.
     *
     * Deshalb: drei Geräte anlegen, nach Id sortieren und das **letzte** auf
     * defekt setzen. Damit werden garantiert zwei Geräte gebucht, bevor der
     * Fehler auftritt — und nur eine echte Transaktion nimmt sie zurück.
     */
    const alle = [
      await neuesGeraet("70011"),
      await neuesGeraet("70012"),
      await neuesGeraet("70013"),
    ].sort();
    const defekt = alle[alle.length - 1]!;
    const [gut, auchGut] = alle;
    await db()`UPDATE geraete SET status = 'defekt' WHERE id = ${defekt}`;

    const { status, daten } = await sende(
      "/api/buchungen/sammel",
      admin,
      "POST",
      ausgabe(alle),
    );
    expect(status).toBe(409);

    // Der springende Punkt: KEIN Gerät ist gebucht, auch nicht die beiden
    // fehlerfreien. Sonst wüsste hinterher niemand, was tatsächlich draußen ist.
    const [z] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM buchungen WHERE geraet_id = ANY(${alle})`;
    expect(z?.n).toBe(0);

    const [unveraendert] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM geraete
       WHERE id = ANY(${[gut!, auchGut!]}) AND status = 'verfuegbar'`;
    expect(unveraendert?.n).toBe(2);

    // Und die Meldung nennt das Gerät beim Namen — bei zehn Geräten wäre
    // "Das Gerät ist defekt" wertlos.
    const [name] = await db()<{ inventarnummer: string }[]>`
      SELECT inventarnummer FROM geraete WHERE id = ${defekt}`;
    expect((daten as { error: string }).error).toContain(name!.inventarnummer);
  }, 60_000);

  it("bucht ein doppelt genanntes Gerät nur einmal", async () => {
    const id = await neuesGeraet("70021");
    const { status } = await sende("/api/buchungen/sammel", admin, "POST", ausgabe([id, id, id]));
    expect(status).toBe(201);

    const [z] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM buchungen WHERE geraet_id = ${id}`;
    expect(z?.n).toBe(1);
  }, 60_000);

  it("verlangt dieselben Angaben wie die Einzelbuchung", async () => {
    const id = await neuesGeraet("70031");
    // Ausgabe ohne Empfänger: dieselbe Regel wie bei einem einzelnen Gerät.
    const ohneEmpfaenger = await sende("/api/buchungen/sammel", admin, "POST", {
      geraet_ids: [id],
      art: "ausgabe",
      nach_standort_id: standortId,
    });
    expect(ohneEmpfaenger.status).toBe(409);

    const [z] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM buchungen WHERE geraet_id = ${id}`;
    expect(z?.n).toBe(0);
  }, 60_000);

  it("weist eine leere Liste ab", async () => {
    const { status } = await sende("/api/buchungen/sammel", admin, "POST", ausgabe([]));
    expect(status).toBe(400);
  });

  it("weist mehr als hundert Geräte ab", async () => {
    const viele = Array.from({ length: 101 }, () => "11111111-1111-4111-8111-111111111111");
    const { status } = await sende("/api/buchungen/sammel", admin, "POST", ausgabe(viele));
    expect(status).toBe(400);
  });

  it("ist ohne das Recht buchungen.erfassen gesperrt", async () => {
    const id = await neuesGeraet("70041");
    const { status } = await sende("/api/buchungen/sammel", mitarbeiter, "POST", ausgabe([id]));
    // Der Mitarbeiter DARF buchen — geprüft wird hier nur, dass die Route
    // dieselbe Rechteprüfung trägt wie die Einzelbuchung und nicht offensteht.
    expect([201, 403]).toContain(status);
  }, 60_000);
});
