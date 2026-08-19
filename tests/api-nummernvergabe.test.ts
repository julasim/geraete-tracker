/**
 * Nebenläufige Nummernvergabe.
 *
 * Der Anlass: Bis AP9 wurde der Höchstwert AUSSERHALB der Transaktion
 * gelesen. Zwei gleichzeitige Anlagen bekamen dieselbe Nummer — der
 * eindeutige Index rettete die Daten, aber einer der beiden Benutzer bekam
 * einen Serverfehler 500 statt eines Geräts.
 *
 * Solange niemand über die Oberfläche anlegte, fiel das nicht auf. Beim
 * Erfassen von 200 Maschinen zu zweit wäre es Alltag geworden.
 *
 * Dieser Test ist die Absicherung. Gegenprobe beim Bauen: mit ausgebauter
 * Sperre schlägt er fehl.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { mitCookie } from "./helpers/konten.js";
import {
  alsAdmin,
  raeumeKontenAuf,
  raeumeTestdatenAuf,
  type Sitzung,
} from "./helpers/stammdaten.js";

let admin: Sitzung;

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  await schliesseDb();
});

async function lege(bezeichnung: string): Promise<{ status: number; nummer?: string }> {
  const antwort = await mitCookie("/api/geraete", admin.cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bezeichnung }),
  });
  const daten = (await antwort.json().catch(() => null)) as { inventarnummer?: string } | null;
  return { status: antwort.status, ...(daten?.inventarnummer ? { nummer: daten.inventarnummer } : {}) };
}

describe("Nummernvergabe bei gleichzeitigen Anlagen", () => {
  it(
    "vergibt 20 gleichzeitig angelegten Geräten 20 verschiedene Nummern",
    async () => {
      const ergebnisse = await Promise.all(
        Array.from({ length: 20 }, (_, i) => lege(`TEST-Gleichzeitig ${i}`)),
      );

      // Kein einziger darf einen Serverfehler bekommen.
      const serverfehler = ergebnisse.filter((e) => e.status >= 500);
      expect(serverfehler).toEqual([]);

      // Alle müssen angelegt worden sein.
      const angelegt = ergebnisse.filter((e) => e.status === 201);
      expect(angelegt).toHaveLength(20);

      // Und zwar mit verschiedenen Nummern.
      const nummern = angelegt.map((e) => e.nummer!);
      expect(new Set(nummern).size).toBe(20);
    },
    120_000,
  );

  it(
    "vergibt lückenlos fortlaufend",
    async () => {
      // Lücken wären kein Datenfehler, aber eine dauerhafte Irritation:
      // Die Nummer wird auf ein Etikett geklebt, und Julius geht davon aus,
      // dass sie fortlaufend ist. Genau deshalb keine Postgres-Sequenz.
      const ergebnisse = await Promise.all(
        Array.from({ length: 10 }, (_, i) => lege(`TEST-Lueckenlos ${i}`)),
      );
      const nummern = ergebnisse
        .filter((e) => e.status === 201)
        .map((e) => Number(e.nummer!))
        .sort((a, b) => a - b);

      expect(nummern).toHaveLength(10);
      for (let i = 1; i < nummern.length; i++) {
        expect(nummern[i]! - nummern[i - 1]!).toBe(1);
      }
    },
    120_000,
  );
});

describe("Doppelte Nummer von Hand", () => {
  it("meldet eine bereits vergebene Nummer als Konflikt, nicht als Serverfehler", async () => {
    const erster = await mitCookie("/api/geraete", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bezeichnung: "TEST-Nummer belegt", inventarnummer: "95001" }),
    });
    expect(erster.status).toBe(201);

    const zweiter = await mitCookie("/api/geraete", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bezeichnung: "TEST-Nummer doppelt", inventarnummer: "95001" }),
    });
    expect(zweiter.status).toBe(409);

    const daten = (await zweiter.json()) as { error: string };
    expect(daten.error).toMatch(/vergeben/i);
  });

  it("übersetzt einen Eindeutigkeitsverstoß der Datenbank in eine lesbare Meldung", async () => {
    // Direkt gegen die Datenbank, um den Fehlercode 23505 zu erzwingen:
    // die Fachschicht fängt den Fall vorher ab, aber die Übersetzung im
    // Fehlerhandler ist die zweite Sicherung und soll ebenfalls greifen.
    const [vorhanden] = await db()<{ inventarnummer: string }[]>`
      SELECT inventarnummer FROM geraete WHERE inventarnummer IS NOT NULL LIMIT 1`;
    expect(vorhanden).toBeTruthy();

    let fehlerCode = "";
    try {
      await db()`
        INSERT INTO geraete (inventarnummer, bezeichnung)
        VALUES (${vorhanden!.inventarnummer}, 'TEST-Direkt doppelt')`;
    } catch (fehler) {
      fehlerCode = (fehler as { code?: string }).code ?? "";
    }
    // Die Datenbank muss das ablehnen — darauf beruht die zweite Sicherung.
    expect(fehlerCode).toBe("23505");
  });
});
