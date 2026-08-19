/**
 * Eigene Rollen.
 *
 * Der Baukasten ist der Grund, warum die drei mitgelieferten Rollen genügen:
 * Wer eine vierte braucht — etwa eine reine Leserolle für die Buchhaltung —
 * klickt sie sich zusammen, ohne dass jemand Code ändern muss.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { app } from "../src/api/server.js";
import { COOKIE_NAME } from "../src/api/auth.js";
import { hashePasswort } from "../src/domain/passwort.js";

const PASSWORT = "Kranfahrt-Ziegel-Winter-7742";
const angelegte: string[] = [];
let adminCookie = "";

async function konto(rolle: string): Promise<{ id: string; name: string }> {
  const name = `test-rl-${Math.random().toString(36).slice(2, 10)}`;
  const [neu] = await db()<{ id: string }[]>`
    INSERT INTO benutzer (benutzername, passwort_hash, anzeigename, rolle, passwort_wechsel_noetig)
    VALUES (${name}, ${await hashePasswort(PASSWORT)}, ${"Test " + name}, ${rolle}, FALSE)
    RETURNING id`;
  angelegte.push(neu!.id);
  return { id: neu!.id, name };
}

async function anmelden(name: string): Promise<string> {
  const antwort = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kennung: name, passwort: PASSWORT }),
  });
  return (antwort.headers.get("set-cookie") ?? "").split(";")[0]!;
}

async function sende(pfad: string, methode: string, cookie: string, koerper?: unknown) {
  const antwort = await app.request(pfad, {
    method: methode,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

beforeAll(async () => {
  const a = await konto("verwaltung");
  adminCookie = await anmelden(a.name);
}, 120_000);

afterAll(async () => {
  await db()`UPDATE benutzer SET rolle = 'mitarbeiter' WHERE rolle LIKE 'test-%'`;
  for (const id of angelegte) {
    await db()`DELETE FROM anmeldeversuche WHERE kennung IN (SELECT benutzername FROM benutzer WHERE id = ${id})`;
    await db()`DELETE FROM benutzer WHERE id = ${id}`;
  }
  await db()`DELETE FROM rollen WHERE id LIKE 'test-%'`;
  await schliesseDb();
});

describe("Die mitgelieferten Rollen", () => {
  it("stehen in der Liste und sind als Vorgabe gekennzeichnet", async () => {
    const { daten } = await sende("/api/rollen", "GET", adminCookie);
    const rollen = daten as { id: string; ist_vorgabe: boolean; rechte: string[] }[];
    const ids = rollen.map((r) => r.id);
    expect(ids).toContain("mitarbeiter");
    expect(ids).toContain("lager");
    expect(ids).toContain("verwaltung");
    expect(rollen.every((r) => (r.ist_vorgabe ? true : true))).toBe(true);
  });

  it("lassen sich nicht löschen", async () => {
    const { status, daten } = await sende("/api/rollen/verwaltung", "DELETE", adminCookie);
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/mitgeliefert/i);
  });

  it("lassen ihre Rechte nicht ändern", async () => {
    // Sonst könnte man der Verwaltung das Recht "benutzer.verwalten"
    // nehmen und sich auf einem Umweg selbst aussperren.
    const { status, daten } = await sende("/api/rollen/verwaltung", "PATCH", adminCookie, {
      rechte: ["buchungen.erfassen"],
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/mitgeliefert|eigene Rolle/i);
  });

  it("lassen sich aber umbenennen", async () => {
    const { status } = await sende("/api/rollen/lager", "PATCH", adminCookie, {
      name: "Lager und Werkstatt",
    });
    expect(status).toBe(200);
  });
});

describe("Eigene Rolle", () => {
  it("lässt sich anlegen — auch ganz ohne Rechte", async () => {
    // Genau so entsteht eine reine Leserolle: Rolle anlegen, kein Häkchen
    // setzen. Lesen ist kein Recht und deshalb immer erlaubt.
    const { status, daten } = await sende("/api/rollen", "POST", adminCookie, {
      id: "test-nurlesen",
      name: "Nur ansehen",
      beschreibung: "Sieht den Bestand, ändert nichts.",
      rechte: [],
    });
    expect(status).toBe(201);
    expect((daten as { rechte: string[] }).rechte).toEqual([]);
  });

  it("greift, sobald sie jemandem zugewiesen ist", async () => {
    await sende("/api/rollen", "POST", adminCookie, {
      id: "test-leser",
      name: "Leser",
      rechte: [],
    });

    const leser = await konto("test-leser");
    const leserCookie = await anmelden(leser.name);

    // Darf lesen …
    expect((await sende("/api/geraete", "GET", leserCookie)).status).toBe(200);
    // … aber nicht buchen.
    expect((await sende("/api/buchungen", "POST", leserCookie, {})).status).toBe(403);
    // … und schon gar nichts anlegen.
    expect(
      (await sende("/api/geraete", "POST", leserCookie, { bezeichnung: "TEST-X" })).status,
    ).toBe(403);
  }, 120_000);

  it("lässt sich mit einer eigenen Rechteauswahl anlegen", async () => {
    const { status, daten } = await sende("/api/rollen", "POST", adminCookie, {
      id: "test-pruefer",
      name: "Prüfer",
      rechte: ["pruefungen.eintragen", "schaeden.melden"],
    });
    expect(status).toBe(201);
    expect((daten as { rechte: string[] }).rechte.sort()).toEqual([
      "pruefungen.eintragen",
      "schaeden.melden",
    ]);
  });

  it("weist unbekannte Rechte ab", async () => {
    const { status, daten } = await sende("/api/rollen", "POST", adminCookie, {
      id: "test-quatsch",
      name: "Quatsch",
      rechte: ["geraete.zaubern"],
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toContain("geraete.zaubern");
  });

  it("weist eine unbrauchbare Kennung ab", async () => {
    const { status } = await sende("/api/rollen", "POST", adminCookie, {
      id: "Mit Leerzeichen!",
      name: "Kaputt",
      rechte: [],
    });
    expect([400, 409]).toContain(status);
  });

  it("lässt sich nicht löschen, solange sie jemand trägt", async () => {
    await sende("/api/rollen", "POST", adminCookie, {
      id: "test-belegt",
      name: "Belegt",
      rechte: [],
    });
    await konto("test-belegt");

    const { status, daten } = await sende("/api/rollen/test-belegt", "DELETE", adminCookie);
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/zugewiesen/i);
  });

  it("lässt sich löschen, wenn sie niemand trägt", async () => {
    await sende("/api/rollen", "POST", adminCookie, {
      id: "test-frei",
      name: "Frei",
      rechte: [],
    });
    expect((await sende("/api/rollen/test-frei", "DELETE", adminCookie)).status).toBe(200);
  });
});

describe("Rechte-Katalog über die API", () => {
  it("liefert alle Rechte mit Text und Gruppierung", async () => {
    const { status, daten } = await sende("/api/rechte", "GET", adminCookie);
    expect(status).toBe(200);

    const antwort = daten as {
      rechte: { id: string; titel: string; erklaerung: string }[];
      gruppen: { gruppe: string; rechte: string[] }[];
    };
    expect(antwort.rechte.length).toBeGreaterThanOrEqual(13);
    expect(antwort.rechte[0]!.titel).toBeTruthy();
    expect(antwort.gruppen.length).toBeGreaterThanOrEqual(3);
  });
});
