/**
 * Die Rechte-Tabelle: jede schreibende Route mit jeder Rolle.
 *
 * Der Grund für diesen Test: In AP10 wurden 27 Routen von einer pauschalen
 * Admin-Prüfung auf einzelne Rechte umgestellt. Eine übersehene Stelle bliebe
 * entweder für alle offen oder für alle gesperrt — und beides fiele im Alltag
 * erst auf, wenn es zu spät ist.
 *
 * Deshalb wird hier nicht stichprobenartig geprüft, sondern vollständig:
 * jede Route × jede Rolle, mit erwartetem Ausgang.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { hashePasswort } from "../src/domain/passwort.js";
import { app } from "../src/api/server.js";
import { COOKIE_NAME } from "../src/api/auth.js";
import { raeumeTestdatenAuf } from "./helpers/stammdaten.js";

type Rolle = "mitarbeiter" | "lager" | "verwaltung";
const ROLLEN: Rolle[] = ["mitarbeiter", "lager", "verwaltung"];

const PASSWORT = "Kranfahrt-Ziegel-Winter-7742";
const cookies: Record<Rolle, string> = { mitarbeiter: "", lager: "", verwaltung: "" };
const kontoIds: string[] = [];

/** Eine Route und wer sie benutzen darf. */
interface RoutenFall {
  methode: string;
  pfad: string;
  /** Rollen, die ein 403 bekommen müssen. */
  verboten: Rolle[];
  koerper?: unknown;
}

/**
 * Alle schreibenden Routen mit ihrer erwarteten Zugänglichkeit.
 *
 * Was NICHT in dieser Liste steht, ist entweder lesend (für alle erlaubt)
 * oder gehört zur Anmeldung. Der Test `api-auth-abdeckung.test.ts` stellt
 * getrennt sicher, dass überhaupt jede Route eine Anmeldung verlangt.
 */
const FAELLE: RoutenFall[] = [
  // ── Täglicher Umgang: alle drei Rollen dürfen ───────────────────────
  { methode: "POST", pfad: "/api/buchungen", verboten: [], koerper: {} },
  { methode: "POST", pfad: "/api/geraete/:id/schaeden", verboten: [], koerper: {} },
  { methode: "POST", pfad: "/api/geraete/:id/dateien", verboten: [] },

  // ── Bauhof: Mitarbeiter dürfen nicht ────────────────────────────────
  { methode: "POST", pfad: "/api/geraete", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "PATCH", pfad: "/api/geraete/:id", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "POST", pfad: "/api/geraete/:id/barcodes", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "DELETE", pfad: "/api/geraete/:id/barcodes/12345", verboten: ["mitarbeiter"] },
  { methode: "POST", pfad: "/api/schlagworte", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "PATCH", pfad: "/api/schlagworte/:id", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "DELETE", pfad: "/api/schlagworte/:id", verboten: ["mitarbeiter"] },
  { methode: "POST", pfad: "/api/standorte", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "PATCH", pfad: "/api/standorte/:id", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "POST", pfad: "/api/lagerplaetze", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "PATCH", pfad: "/api/lagerplaetze/:id", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "POST", pfad: "/api/pruefarten", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "POST", pfad: "/api/geraete/:id/pruefungen", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "PATCH", pfad: "/api/schaeden/:id", verboten: ["mitarbeiter"], koerper: {} },
  { methode: "POST", pfad: "/api/dateien/:id/titelbild", verboten: ["mitarbeiter"] },
  { methode: "DELETE", pfad: "/api/dateien/:id", verboten: ["mitarbeiter"] },
  { methode: "GET", pfad: "/api/etiketten/formate", verboten: ["mitarbeiter"] },
  { methode: "GET", pfad: "/api/etiketten/testbogen", verboten: ["mitarbeiter"] },
  { methode: "POST", pfad: "/api/etiketten", verboten: ["mitarbeiter"], koerper: {} },

  // ── Folgenreich: nur die Verwaltung ─────────────────────────────────
  { methode: "POST", pfad: "/api/geraete/:id/ausmustern", verboten: ["mitarbeiter", "lager"] },
  { methode: "POST", pfad: "/api/buchungen/korrektur", verboten: ["mitarbeiter", "lager"], koerper: {} },
  { methode: "GET", pfad: "/api/export/geraete.csv", verboten: ["mitarbeiter", "lager"] },
  { methode: "POST", pfad: "/api/import/geraete", verboten: ["mitarbeiter", "lager"] },
  { methode: "POST", pfad: "/api/import/geraete/pruefen", verboten: ["mitarbeiter", "lager"] },
  { methode: "POST", pfad: "/api/benutzer", verboten: ["mitarbeiter", "lager"], koerper: {} },
  { methode: "PATCH", pfad: "/api/benutzer/:id", verboten: ["mitarbeiter", "lager"], koerper: {} },
  { methode: "POST", pfad: "/api/rollen", verboten: ["mitarbeiter", "lager"], koerper: {} },
  { methode: "PATCH", pfad: "/api/rollen/:id", verboten: ["mitarbeiter", "lager"], koerper: {} },
  { methode: "DELETE", pfad: "/api/rollen/:id", verboten: ["mitarbeiter", "lager"] },
];

const BEISPIEL_ID = "00000000-0000-0000-0000-000000000000";

async function anmelden(rolle: Rolle): Promise<string> {
  const name = `test-rechte-${rolle}-${Math.random().toString(36).slice(2, 8)}`;
  const [konto] = await db()<{ id: string }[]>`
    INSERT INTO benutzer (benutzername, passwort_hash, anzeigename, rolle, passwort_wechsel_noetig)
    VALUES (${name}, ${await hashePasswort(PASSWORT)}, ${"Test " + rolle}, ${rolle}, FALSE)
    RETURNING id`;
  kontoIds.push(konto!.id);

  const antwort = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kennung: name, passwort: PASSWORT }),
  });
  const gesetzt = antwort.headers.get("set-cookie") ?? "";
  if (!gesetzt.includes(COOKIE_NAME)) throw new Error(`Anmeldung als ${rolle} fehlgeschlagen`);
  return gesetzt.split(";")[0]!;
}

beforeAll(async () => {
  await raeumeTestdatenAuf();
  for (const rolle of ROLLEN) cookies[rolle] = await anmelden(rolle);
}, 120_000);

afterAll(async () => {
  for (const id of kontoIds) {
    await db()`DELETE FROM anmeldeversuche WHERE kennung IN (SELECT benutzername FROM benutzer WHERE id = ${id})`;
    await db()`DELETE FROM benutzer WHERE id = ${id}`;
  }
  await raeumeTestdatenAuf();
  await schliesseDb();
});

async function rufeAuf(fall: RoutenFall, cookie: string): Promise<number> {
  const pfad = fall.pfad.replace(/:[a-zA-Z]+/g, BEISPIEL_ID);
  const antwort = await app.request(pfad, {
    method: fall.methode,
    headers: {
      Cookie: cookie,
      ...(fall.koerper !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(fall.koerper !== undefined ? { body: JSON.stringify(fall.koerper) } : {}),
  });
  return antwort.status;
}

describe("Rechte-Tabelle", () => {
  it(`deckt alle ${FAELLE.length} schreibenden Routen ab`, () => {
    // Wächst die App, muss diese Liste mitwachsen. Die Zahl hier ist die
    // Erinnerung daran.
    expect(FAELLE.length).toBeGreaterThanOrEqual(30);
  });

  it(
    "weist jede Rolle genau dort ab, wo sie kein Recht hat",
    async () => {
      const abweichungen: string[] = [];

      for (const fall of FAELLE) {
        for (const rolle of ROLLEN) {
          const status = await rufeAuf(fall, cookies[rolle]);
          const sollVerboten = fall.verboten.includes(rolle);

          if (sollVerboten && status !== 403) {
            abweichungen.push(
              `${fall.methode} ${fall.pfad} als ${rolle}: ${status} — erwartet 403 (verboten)`,
            );
          }
          if (!sollVerboten && status === 403) {
            abweichungen.push(
              `${fall.methode} ${fall.pfad} als ${rolle}: 403 — sollte erlaubt sein`,
            );
          }
        }
      }

      expect(abweichungen).toEqual([]);
    },
    240_000,
  );
});

describe("Der Schutz sitzt im Server", () => {
  it("weist einen Mitarbeiter ab, auch wenn er den Aufruf von Hand absetzt", async () => {
    // Wer im Browser das Rechte-Objekt manipuliert, sieht mehr Knöpfe. Beim
    // Drücken entscheidet aber der Server — das ist der eigentliche Schutz.
    const status = await rufeAuf(
      { methode: "POST", pfad: "/api/geraete", verboten: [], koerper: { bezeichnung: "TEST-Verboten" } },
      cookies.mitarbeiter,
    );
    expect(status).toBe(403);

    const [angelegt] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM geraete WHERE bezeichnung = 'TEST-Verboten'`;
    expect(angelegt!.n).toBe(0);
  });

  it("nennt in der Meldung, welches Recht fehlt", async () => {
    const antwort = await app.request("/api/geraete", {
      method: "POST",
      headers: { Cookie: cookies.mitarbeiter, "Content-Type": "application/json" },
      body: JSON.stringify({ bezeichnung: "TEST-Meldung" }),
    });
    const daten = (await antwort.json()) as { error: string };
    // Niemand soll rätseln, warum ein Knopf nicht wirkt.
    expect(daten.error).toMatch(/Berechtigung|Rolle/i);
  });
});

describe("Lesen bleibt für alle offen", () => {
  const LESEND = [
    "/api/geraete",
    "/api/standorte",
    "/api/lagerplaetze",
    "/api/schlagworte",
    "/api/pruefarten",
    "/api/schaeden",
    "/api/buchungen/offen",
    "/api/pruefungen/faellig",
    "/api/dashboard",
  ];

  it("lässt auch einen Mitarbeiter überall nachsehen", async () => {
    // Die Frage "wo ist der Rüttler?" muss jeder beantworten können.
    const gesperrt: string[] = [];
    for (const pfad of LESEND) {
      const antwort = await app.request(pfad, { headers: { Cookie: cookies.mitarbeiter } });
      if (antwort.status === 403) gesperrt.push(`${pfad} → 403`);
    }
    expect(gesperrt).toEqual([]);
  });
});
