/**
 * Benutzerverwaltung.
 *
 * Der Schwerpunkt liegt auf den Sperren gegen das eigene Aussperren. Ohne
 * sie könnte Julius sich das Recht `benutzer.verwalten` nehmen oder sein
 * Konto deaktivieren — und niemand käme mehr an die Benutzerverwaltung.
 * Die App wäre nur noch über die Kommandozeile am Mini-PC zu retten.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { app } from "../src/api/server.js";
import { COOKIE_NAME } from "../src/api/auth.js";
import { hashePasswort } from "../src/domain/passwort.js";
import { aendereBenutzer } from "../src/data/benutzer.js";

const PASSWORT = "Kranfahrt-Ziegel-Winter-7742";
const angelegte: string[] = [];

let adminId = "";
let adminCookie = "";
let adminName = "";

async function konto(rolle: string, aktiv = true): Promise<{ id: string; name: string }> {
  const name = `test-bv-${Math.random().toString(36).slice(2, 10)}`;
  const [neu] = await db()<{ id: string }[]>`
    INSERT INTO benutzer (benutzername, passwort_hash, anzeigename, rolle, aktiv,
                          passwort_wechsel_noetig)
    VALUES (${name}, ${await hashePasswort(PASSWORT)}, ${"Test " + name}, ${rolle},
            ${aktiv}, FALSE)
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
  const gesetzt = antwort.headers.get("set-cookie") ?? "";
  if (!gesetzt.includes(COOKIE_NAME)) throw new Error(`Anmeldung als ${name} fehlgeschlagen`);
  return gesetzt.split(";")[0]!;
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
  adminId = a.id;
  adminName = a.name;
  adminCookie = await anmelden(a.name);
}, 120_000);

afterAll(async () => {
  // Die Aussperr-Tests legen zwischendurch ECHTE Konten still, um den Fall
  // "letzter Verwalter" überhaupt herstellen zu können. Wird das nicht
  // zurückgenommen, bleibt die Entwicklungsumgebung ohne Anmeldung zurück —
  // beim Bau genau so passiert: Nach einem Testlauf war das Probe-Konto tot.
  await db()`
    UPDATE benutzer SET aktiv = TRUE, fehlversuche = 0, gesperrt_bis = NULL
     WHERE benutzername NOT LIKE 'test-%'`;

  await db()`UPDATE benutzer SET rolle = 'mitarbeiter' WHERE rolle LIKE 'test-bv-%'`;
  for (const id of angelegte) {
    await db()`DELETE FROM anmeldeversuche WHERE kennung IN (SELECT benutzername FROM benutzer WHERE id = ${id})`;
    await db()`DELETE FROM benutzer WHERE id = ${id}`;
  }
  await db()`DELETE FROM rollen WHERE id LIKE 'test-%'`;
  await db()`DELETE FROM rollen WHERE id LIKE 'test-bv-%'`;
  await schliesseDb();
});

describe("Konto anlegen", () => {
  it("legt ein Konto an und liefert das Einmalpasswort — genau einmal", async () => {
    const name = `test-bv-neu-${Math.random().toString(36).slice(2, 8)}`;
    const { status, daten } = await sende("/api/benutzer", "POST", adminCookie, {
      benutzername: name,
      anzeigename: "Neuer Mitarbeiter",
      rolle: "mitarbeiter",
    });
    expect(status).toBe(201);

    const antwort = daten as { benutzer: { id: string }; einmalpasswort: string };
    angelegte.push(antwort.benutzer.id);

    // Vier Wörter mit Bindestrichen — vorlesbar über den Bauhof hinweg.
    expect(antwort.einmalpasswort).toMatch(/^[A-Za-zÄÖÜäöü]+(-[A-Za-zÄÖÜäöü]+){3}-\d{2}$/);
    expect(antwort.einmalpasswort.length).toBeGreaterThanOrEqual(12);

    // Beim zweiten Abruf gibt es das Passwort nicht mehr.
    const detail = await sende(`/api/benutzer`, "GET", adminCookie);
    expect(JSON.stringify(detail.daten)).not.toContain(antwort.einmalpasswort);
  });

  it("erzwingt beim ersten Anmelden den Passwortwechsel", async () => {
    const name = `test-bv-wechsel-${Math.random().toString(36).slice(2, 8)}`;
    const { daten } = await sende("/api/benutzer", "POST", adminCookie, {
      benutzername: name,
      anzeigename: "Wechsel nötig",
      rolle: "mitarbeiter",
    });
    const antwort = daten as { benutzer: { id: string }; einmalpasswort: string };
    angelegte.push(antwort.benutzer.id);

    const anmeldung = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kennung: name, passwort: antwort.einmalpasswort }),
    });
    expect(anmeldung.status).toBe(200);
    const koerper = (await anmeldung.json()) as { passwortWechselNoetig: boolean };
    expect(koerper.passwortWechselNoetig).toBe(true);
  });

  it("weist einen doppelten Benutzernamen ab", async () => {
    const { status } = await sende("/api/benutzer", "POST", adminCookie, {
      benutzername: adminName,
      anzeigename: "Doppelt",
      rolle: "mitarbeiter",
    });
    expect(status).toBe(409);
  });
});

describe("Aussperr-Schutz", () => {
  it("verweigert das Deaktivieren des letzten Verwaltungskontos", async () => {
    // Aufräumen: sicherstellen, dass NUR dieses eine Verwaltungskonto aktiv ist
    const andere = await db()<{ id: string }[]>`
      SELECT b.id FROM benutzer b JOIN rollen r ON r.id = b.rolle
       WHERE b.id <> ${adminId} AND b.aktiv AND 'benutzer.verwalten' = ANY(r.rechte)`;
    for (const a of andere) await db()`UPDATE benutzer SET aktiv = FALSE WHERE id = ${a.id}`;

    // Ein zweites Verwaltungskonto anlegen, um es aus SEINER Sicht zu prüfen
    const zweiter = await konto("verwaltung");
    const zweiterCookie = await anmelden(zweiter.name);

    // Jetzt das erste deaktivieren — erlaubt, weil ein zweites bleibt
    const erlaubt = await sende(`/api/benutzer/${adminId}`, "PATCH", zweiterCookie, {
      aktiv: false,
    });
    expect(erlaubt.status).toBe(200);

    // Und nun das letzte: muss abgewiesen werden
    const dritter = await konto("mitarbeiter");
    const drittCookie = await anmelden(dritter.name);
    expect((await sende(`/api/benutzer/${zweiter.id}`, "PATCH", drittCookie, { aktiv: false })).status)
      .toBe(403); // Mitarbeiter darf ohnehin nicht

    // Aus Sicht des letzten Verwalters selbst (Selbstschutz greift zuerst)
    const selbst = await sende(`/api/benutzer/${zweiter.id}`, "PATCH", zweiterCookie, {
      aktiv: false,
    });
    expect(selbst.status).toBe(409);
    expect((selbst.daten as { error: string }).error).toMatch(/eigenen Konto/i);

    // Aufräumen: den ersten wieder aktivieren
    await db()`UPDATE benutzer SET aktiv = TRUE WHERE id = ${adminId}`;
    adminCookie = await anmelden(adminName);
  }, 120_000);

  it("verweigert, dem letzten Verwaltungskonto die Rolle zu nehmen", async () => {
    // Zwei Verwalter: A (der Handelnde) und B (der Betroffene)
    const b = await konto("verwaltung");

    // Alle anderen Verwalter stilllegen, damit B der letzte ist außer A …
    const andere = await db()<{ id: string }[]>`
      SELECT b2.id FROM benutzer b2 JOIN rollen r ON r.id = b2.rolle
       WHERE b2.id NOT IN (${adminId}, ${b.id}) AND b2.aktiv
         AND 'benutzer.verwalten' = ANY(r.rechte)`;
    for (const a of andere) await db()`UPDATE benutzer SET aktiv = FALSE WHERE id = ${a.id}`;

    // … dann A stilllegen, sodass B wirklich der letzte ist.
    const aCookie = await anmelden(b.name); // B meldet sich an
    await sende(`/api/benutzer/${adminId}`, "PATCH", aCookie, { aktiv: false });

    // Jetzt kann B sich nicht selbst herabstufen (Selbstschutz) …
    const selbst = await sende(`/api/benutzer/${b.id}`, "PATCH", aCookie, {
      rolle: "mitarbeiter",
    });
    expect(selbst.status).toBe(409);

    // Aufräumen
    await db()`UPDATE benutzer SET aktiv = TRUE WHERE id = ${adminId}`;
    adminCookie = await anmelden(adminName);
  }, 120_000);

  it("lässt niemanden die eigene Rolle ändern", async () => {
    const { status, daten } = await sende(`/api/benutzer/${adminId}`, "PATCH", adminCookie, {
      rolle: "mitarbeiter",
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/eigenen Konto/i);
  });

  it("lässt niemanden sich selbst deaktivieren", async () => {
    const { status } = await sende(`/api/benutzer/${adminId}`, "PATCH", adminCookie, {
      aktiv: false,
    });
    expect(status).toBe(409);
  });

  /**
   * Der Schutz aus `pruefeLetzterVerwalter` ist über die API NICHT auslösbar:
   * Wer handelt, ist selbst ein aktiver Verwalter, also bleibt nach jeder
   * Änderung an einem FREMDEN Konto mindestens er übrig — und am eigenen
   * greift zuerst der Selbstschutz. Das ist beim Bau durch eine Gegenprobe
   * aufgefallen (Schutz ausgebaut → alle Tests blieben grün).
   *
   * Er bleibt trotzdem im Code, als Netz für einen künftigen zweiten Weg zu
   * denselben Daten. Damit er nicht still verrottet, wird er hier direkt auf
   * der Datenschicht geprüft — mit einem Akteur, der nicht der Betroffene ist.
   */
  it("greift auf der Datenschicht, wenn der letzte Verwalter fremdbestimmt fiele", async () => {
    const andere = await db()<{ id: string }[]>`
      SELECT b.id FROM benutzer b JOIN rollen r ON r.id = b.rolle
       WHERE b.aktiv AND b.id <> ${adminId} AND 'benutzer.verwalten' = ANY(r.rechte)`;
    for (const a of andere) await db()`UPDATE benutzer SET aktiv = FALSE WHERE id = ${a.id}`;

    // Ein Mitarbeiterkonto als Akteur — so gäbe es hinterher wirklich niemanden.
    const fremder = await konto("mitarbeiter");

    await expect(
      aendereBenutzer(adminId, { rolle: "mitarbeiter" }, fremder.id),
    ).rejects.toThrow(/letzte Konto/i);

    for (const a of andere) await db()`UPDATE benutzer SET aktiv = TRUE WHERE id = ${a.id}`;
  }, 120_000);

  /**
   * Der zweite Aussperr-Weg, und der einzige über die API erreichbare: nicht
   * am Konto drehen, sondern der Rolle das Recht nehmen. Die mitgelieferten
   * Rollen sind davor geschützt, weil ihre Rechte fest sind — eine EIGENE
   * Verwaltungsrolle war es bis zu diesem Test nicht.
   */
  it("verweigert, der letzten Verwaltungsrolle ihr Recht zu nehmen", async () => {
    await sende("/api/rollen", "POST", adminCookie, {
      id: "test-bv-chef",
      name: "Chef",
      rechte: ["benutzer.verwalten"],
    });
    const chef = await konto("test-bv-chef");
    const chefCookie = await anmelden(chef.name);

    // Alle übrigen Verwalter stilllegen — jetzt hängt alles an dieser Rolle.
    const andere = await db()<{ id: string }[]>`
      SELECT b.id FROM benutzer b JOIN rollen r ON r.id = b.rolle
       WHERE b.aktiv AND b.rolle <> 'test-bv-chef' AND 'benutzer.verwalten' = ANY(r.rechte)`;
    for (const a of andere) await db()`UPDATE benutzer SET aktiv = FALSE WHERE id = ${a.id}`;

    const { status, daten } = await sende("/api/rollen/test-bv-chef", "PATCH", chefCookie, {
      rechte: [],
    });

    for (const a of andere) await db()`UPDATE benutzer SET aktiv = TRUE WHERE id = ${a.id}`;
    adminCookie = await anmelden(adminName);

    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/letzte Rolle/i);
  }, 120_000);

  it("lässt das eigene Passwort nicht über das Zurücksetzen ändern", async () => {
    const { status } = await sende(`/api/benutzer/${adminId}/passwort`, "POST", adminCookie);
    expect(status).toBe(409);
  });
});

describe("Rollenwechsel wirkt sofort", () => {
  it("beendet die Sitzungen des Betroffenen", async () => {
    const opfer = await konto("verwaltung");
    const opferCookie = await anmelden(opfer.name);

    // Vorher: darf Geräte anlegen
    expect(
      (await sende("/api/geraete", "POST", opferCookie, { bezeichnung: "TEST-Vorher" })).status,
    ).toBe(201);

    // Herabstufen durch jemand anderen
    const geaendert = await sende(`/api/benutzer/${opfer.id}`, "PATCH", adminCookie, {
      rolle: "mitarbeiter",
    });
    expect(geaendert.status).toBe(200);

    // Die alte Sitzung gilt nicht mehr — der Betroffene soll merken,
    // dass sich etwas geändert hat, statt in 403-Meldungen zu laufen.
    const danach = await sende("/api/geraete", "POST", opferCookie, {
      bezeichnung: "TEST-Nachher",
    });
    expect(danach.status).toBe(401);

    // Nach neuer Anmeldung greift die neue Rolle.
    const neuerCookie = await anmelden(opfer.name);
    expect(
      (await sende("/api/geraete", "POST", neuerCookie, { bezeichnung: "TEST-Danach" })).status,
    ).toBe(403);

    await db()`DELETE FROM geraete WHERE bezeichnung LIKE 'TEST-Vorher'`;
  }, 120_000);
});

describe("Die Benutzerliste zeigt nur, was nötig ist", () => {
  it("liefert der Verwaltung Rolle und Zustand", async () => {
    const { daten } = await sende("/api/benutzer", "GET", adminCookie);
    const erster = (daten as Record<string, unknown>[])[0]!;
    expect(erster).toHaveProperty("rolle");
    expect(erster).toHaveProperty("aktiv");
  });

  it("liefert Mitarbeitern nur Kennung, Name und Zustand", async () => {
    // Beim Ausgeben braucht jeder die Namensliste — aber niemand muss
    // sehen, wer welche Rolle hat oder wann er zuletzt angemeldet war.
    const ma = await konto("mitarbeiter");
    const maCookie = await anmelden(ma.name);

    const { status, daten } = await sende("/api/benutzer", "GET", maCookie);
    expect(status).toBe(200);

    const erster = (daten as Record<string, unknown>[])[0]!;
    expect(Object.keys(erster).sort()).toEqual(["aktiv", "anzeigename", "id"]);
    expect(erster).not.toHaveProperty("rolle");
    expect(erster).not.toHaveProperty("letzter_login");
  });

  it("gibt niemals einen Passwort-Hash preis", async () => {
    const { daten } = await sende("/api/benutzer", "GET", adminCookie);
    expect(JSON.stringify(daten)).not.toContain("argon2");
    expect(JSON.stringify(daten)).not.toContain("passwort_hash");
  });
});
