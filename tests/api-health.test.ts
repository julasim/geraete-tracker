/**
 * Die Gesundheitsprüfung muss die Wahrheit sagen.
 *
 * Sie antwortete früher immer `{ok:true}`, ohne die Datenbank anzufassen.
 * In dieser Umgebung ist genau das passiert: Docker meldete `healthy`,
 * während jede Anmeldung an einer weggebrochenen Datenbankverbindung
 * scheiterte. Auf dem Mini-PC hieße das: kein Neustart, keine Meldung —
 * bis jemand auf der Baustelle steht und nichts buchen kann.
 *
 * Der Endpunkt ist anonym erreichbar. Er darf deshalb sagen OB, aber nicht
 * WARUM — kein Fehlertext, keine Version, kein Hinweis auf die Datenbank.
 */

import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { app, datenbankErreichbar } from "../src/api/server.js";
import { db, schliesseDb } from "../src/db/client.js";

afterAll(async () => {
  await schliesseDb();
});

describe("Gesundheitsprüfung", () => {
  it("meldet 200, solange die Datenbank antwortet", async () => {
    const antwort = await app.request("/api/health");
    expect(antwort.status).toBe(200);
    expect(await antwort.json()).toEqual({ ok: true });
  });

  it("verrät nichts über das Innenleben", async () => {
    const daten = (await (await app.request("/api/health")).json()) as Record<string, unknown>;
    // Genau ein Feld: ok. Keine Version, kein Datenbankname, keine Laufzeit.
    expect(Object.keys(daten)).toEqual(["ok"]);
  });

  it("braucht keine Anmeldung", async () => {
    // Ohne Cookie — sonst könnte der Container sich nicht selbst prüfen.
    expect((await app.request("/api/health")).status).toBe(200);
  });

  it("fragt die Datenbank nicht bei jedem Aufruf", async () => {
    // Der Endpunkt ist anonym: Ohne Gedächtnis könnte eine Anfrageflut
    // Datenbanklast erzeugen. Zehn Aufrufe müssen deshalb zügig gehen.
    const start = Date.now();
    for (let i = 0; i < 10; i++) await app.request("/api/health");
    expect(Date.now() - start).toBeLessThan(1000);
  });
});

describe("Wenn die Datenbank nicht antwortet", () => {
  /**
   * Der Kern der Sache. Geprüft wird die Funktion, die hinter dem Endpunkt
   * steckt — mit einem Client, der ins Leere zeigt.
   *
   * Bewusst NICHT, indem die laufende Testdatenbank angehalten wird: Diese
   * Datei läuft gegen dieselbe Datenbank wie alle anderen, und eine Prüfung,
   * die dafür den Betrieb abschaltet, richtet mehr Schaden an als sie belegt.
   * Der Weg von 503 bis zum roten Container ist im Betrieb gegengeprüft
   * (`docker stop tracker-postgres` → App wird `unhealthy`); hier steht die
   * Entscheidung selbst.
   */
  it("erkennt eine tote Verbindung als ungesund", async () => {
    const insLeere = postgres("postgres://niemand:niemand@127.0.0.1:59999/nichts", {
      connect_timeout: 2,
      max: 1,
      onnotice: () => {},
    });
    try {
      expect(await datenbankErreichbar(insLeere)).toBe(false);
    } finally {
      await insLeere.end({ timeout: 1 });
    }
  }, 30_000);

  it("erkennt die echte Verbindung als gesund", async () => {
    expect(await datenbankErreichbar(db())).toBe(true);
  });

  it("lässt einen Prüf-Client den laufenden Betrieb nicht vergiften", async () => {
    // Ein ausdrücklich übergebener Client umgeht das Gedächtnis. Ohne das
    // hätte der Test darüber den Zustand auf "krank" gesetzt — und der
    // Container wäre wegen einer Prüfung ausgefallen.
    const insLeere = postgres("postgres://niemand:niemand@127.0.0.1:59999/nichts", {
      connect_timeout: 2,
      max: 1,
      onnotice: () => {},
    });
    try {
      await datenbankErreichbar(insLeere);
    } finally {
      await insLeere.end({ timeout: 1 });
    }

    const antwort = await app.request("/api/health");
    expect(antwort.status).toBe(200);
  }, 30_000);
});
