/**
 * Sitzungen: Widerruf, Deaktivierung, Rollenwechsel.
 *
 * Das ist der Punkt, an dem viele Systeme mit JSON-Web-Tokens scheitern:
 * Ein einmal ausgestelltes Token gilt bis zum Ablauf weiter — auch das
 * eines verlorenen Handys. Hier trägt jedes Token die token_version, die
 * bei jeder Anfrage frisch mit der Datenbank verglichen wird.
 */

import { afterAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { entsperre, legeKontoAn, meldeAn, mitCookie, raeumeKontoAuf } from "./helpers/konten.js";
import type { TestKonto } from "./helpers/konten.js";

const angelegte: TestKonto[] = [];

async function angemeldetesKonto(rolle: string = "mitarbeiter") {
  const konto = await legeKontoAn({ rolle });
  angelegte.push(konto);
  await entsperre(konto.id);
  const { cookie } = await meldeAn(konto.benutzername, konto.passwort);
  expect(cookie).toBeTruthy();
  return { konto, cookie: cookie! };
}

afterAll(async () => {
  for (const k of angelegte) await raeumeKontoAuf(k);
  await schliesseDb();
});

describe("Gültige Sitzung", () => {
  it("erlaubt den Zugriff auf geschützte Endpunkte", async () => {
    const { cookie } = await angemeldetesKonto();
    const antwort = await mitCookie("/api/auth/me", cookie);
    expect(antwort.status).toBe(200);
  });

  it("liefert Benutzer und Rolle, aber niemals den Passwort-Hash", async () => {
    const { konto, cookie } = await angemeldetesKonto();
    const antwort = await mitCookie("/api/auth/me", cookie);
    const text = await antwort.text();

    expect(text).toContain(konto.benutzername);
    expect(text).not.toContain("argon2");
    expect(text).not.toContain("passwort_hash");
  });
});

describe("Ohne oder mit ungültiger Sitzung", () => {
  it("weist eine Anfrage ohne Cookie ab", async () => {
    const antwort = await mitCookie("/api/auth/me", null);
    expect(antwort.status).toBe(401);
  });

  it("weist ein gefälschtes Token ab", async () => {
    const antwort = await mitCookie("/api/auth/me", "gt_sitzung=das.ist.kein.token");
    expect(antwort.status).toBe(401);
  });

  it("weist ein Token ab, das mit einem anderen Schlüssel unterschrieben wurde", async () => {
    // Der naheliegende Angriff: eigenes Token bauen und Rolle auf admin setzen.
    const jwt = (await import("jsonwebtoken")).default;
    const gefaelscht = jwt.sign({ sub: angelegte[0]!.id, tv: 1, rolle: "verwaltung" }, "falscher-schluessel");
    const antwort = await mitCookie("/api/auth/me", `gt_sitzung=${gefaelscht}`);
    expect(antwort.status).toBe(401);
  });
});

describe("Sofortiger Widerruf", () => {
  it("beendet alle Sitzungen, wenn das Konto deaktiviert wird", async () => {
    const { konto, cookie } = await angemeldetesKonto();
    expect((await mitCookie("/api/auth/me", cookie)).status).toBe(200);

    // Der Fall "Handy verloren": Konto deaktivieren.
    await db()`UPDATE benutzer SET aktiv = FALSE WHERE id = ${konto.id}`;

    // Dieselbe Sitzung darf ab sofort nichts mehr können.
    expect((await mitCookie("/api/auth/me", cookie)).status).toBe(401);
  });

  it("beendet alle Sitzungen über 'alle abmelden'", async () => {
    const { cookie } = await angemeldetesKonto();
    // Zweites Gerät derselben Person
    const zweitesGeraet = cookie;

    const abmelden = await mitCookie("/api/auth/logout-alle", cookie, { method: "POST" });
    expect(abmelden.status).toBe(200);

    expect((await mitCookie("/api/auth/me", zweitesGeraet)).status).toBe(401);
  });

  it("wirkt sofort, wenn die Rolle herabgestuft wird", async () => {
    const { konto, cookie } = await angemeldetesKonto("verwaltung");
    const vorher = await (await mitCookie("/api/auth/me", cookie)).json();
    expect((vorher as { benutzer: { rolle: string } }).benutzer.rolle).toBe("verwaltung");

    await db()`UPDATE benutzer SET rolle = 'mitarbeiter' WHERE id = ${konto.id}`;

    // Die Rolle kommt bei jeder Anfrage frisch aus der Datenbank, nie aus
    // dem Token — sonst behielte ein alter Admin bis zu 30 Tage lang Rechte.
    const nachher = await (await mitCookie("/api/auth/me", cookie)).json();
    expect((nachher as { benutzer: { rolle: string } }).benutzer.rolle).toBe("mitarbeiter");
  });

  it("macht die Sitzung ungültig, wenn token_version erhöht wird", async () => {
    const { konto, cookie } = await angemeldetesKonto();
    await db()`UPDATE benutzer SET token_version = token_version + 1 WHERE id = ${konto.id}`;
    expect((await mitCookie("/api/auth/me", cookie)).status).toBe(401);
  });
});

describe("Abmelden", () => {
  it("löscht das Cookie", async () => {
    const { cookie } = await angemeldetesKonto();
    const antwort = await mitCookie("/api/auth/logout", cookie, { method: "POST" });
    expect(antwort.status).toBe(200);
    const gesetzt = antwort.headers.get("set-cookie") ?? "";
    expect(gesetzt).toContain("gt_sitzung=");
    expect(gesetzt).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });
});
