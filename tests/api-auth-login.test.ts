/**
 * Anmeldung: was funktionieren muss, und vor allem was NICHT verraten werden darf.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { legeKontoAn, meldeAn, entsperre, raeumeKontoAuf } from "./helpers/konten.js";
import type { TestKonto } from "./helpers/konten.js";

let konto: TestKonto;

beforeAll(async () => {
  konto = await legeKontoAn({ rolle: "mitarbeiter", email: "test@example.at" });
});

afterAll(async () => {
  await raeumeKontoAuf(konto);
  await schliesseDb();
});

describe("Anmeldung", () => {
  it("nimmt richtige Zugangsdaten an und setzt ein Cookie", async () => {
    await entsperre(konto.id);
    const { status, cookie } = await meldeAn(konto.benutzername, konto.passwort);
    expect(status).toBe(200);
    expect(cookie).toContain("gt_sitzung=");
  });

  it("setzt das Cookie httpOnly und SameSite=Strict", async () => {
    await entsperre(konto.id);
    const antwort = await (
      await import("../src/api/server.js")
    ).app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kennung: konto.benutzername, passwort: konto.passwort }),
    });
    const cookie = antwort.headers.get("set-cookie") ?? "";
    // httpOnly: ein eingeschleustes Skript kann das Token nicht auslesen
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
  });

  it("erlaubt die Anmeldung auch über die E-Mail-Adresse", async () => {
    await entsperre(konto.id);
    const { status, cookie } = await meldeAn("test@example.at", konto.passwort);
    expect(status).toBe(200);
    expect(cookie).toBeTruthy();
  });

  it("ist bei der Kennung unabhängig von Groß-/Kleinschreibung", async () => {
    await entsperre(konto.id);
    const { status } = await meldeAn(konto.benutzername.toUpperCase(), konto.passwort);
    expect(status).toBe(200);
  });

  it("weist ein falsches Passwort ab, ohne Cookie zu setzen", async () => {
    await entsperre(konto.id);
    const { status, cookie } = await meldeAn(konto.benutzername, "falsch-falsch-falsch");
    expect(status).toBe(401);
    expect(cookie).toBeNull();
  });

  it("weist ein deaktiviertes Konto ab", async () => {
    const gesperrt = await legeKontoAn({ aktiv: false });
    const { status, cookie } = await meldeAn(gesperrt.benutzername, gesperrt.passwort);
    expect(status).toBe(401);
    expect(cookie).toBeNull();
    await raeumeKontoAuf(gesperrt);
  });

  it("nimmt eine unvollständige Anfrage nicht an", async () => {
    const { app } = await import("../src/api/server.js");
    const antwort = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kennung: "nur-name" }),
    });
    expect(antwort.status).toBe(400);
  });
});

describe("Verrät nicht, welche Konten existieren", () => {
  it("antwortet bei unbekanntem Konto mit demselben Text wie bei falschem Passwort", async () => {
    await entsperre(konto.id);
    const falsch = await meldeAn(konto.benutzername, "falsch-falsch-falsch");
    const unbekannt = await meldeAn("gibt-es-nicht-xyz", "falsch-falsch-falsch");

    expect(unbekannt.status).toBe(falsch.status);
    expect((unbekannt.koerper as { error: string }).error).toBe(
      (falsch.koerper as { error: string }).error,
    );
  });

  it("antwortet bei unbekanntem Konto nicht schneller als bei falschem Passwort", async () => {
    // Der eigentliche Punkt: Ohne den Vergleichs-Hash wäre der unbekannte
    // Weg deutlich schneller — daran ließe sich ablesen, welche Konten es
    // gibt. Gemessen wird großzügig, weil Testmaschinen schwanken.
    await entsperre(konto.id);
    const t1 = Date.now();
    await meldeAn(konto.benutzername, "falsch-falsch-falsch");
    const dauerBekannt = Date.now() - t1;

    const t2 = Date.now();
    await meldeAn("gibt-es-nicht-xyz", "falsch-falsch-falsch");
    const dauerUnbekannt = Date.now() - t2;

    // Der unbekannte Weg darf nicht auffällig schneller sein.
    expect(dauerUnbekannt).toBeGreaterThan(dauerBekannt * 0.5);
  });
});

describe("Protokoll", () => {
  it("hält jeden Fehlversuch fest, auch auf ein nicht existierendes Konto", async () => {
    const kennung = `gibt-es-nicht-${Math.random().toString(36).slice(2, 8)}`;
    await meldeAn(kennung, "irgendwas-falsches");

    const zeilen = await db()<{ grund: string; erfolg: boolean }[]>`
      SELECT grund, erfolg FROM anmeldeversuche WHERE kennung = ${kennung}`;
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]!.erfolg).toBe(false);
    expect(zeilen[0]!.grund).toBe("unbekannt");

    await db()`DELETE FROM anmeldeversuche WHERE kennung = ${kennung}`;
  });

  it("schreibt niemals das Passwort ins Protokoll", async () => {
    const kennung = `spur-${Math.random().toString(36).slice(2, 8)}`;
    const geheim = "Dieses-Passwort-darf-nirgends-stehen-8842";
    await meldeAn(kennung, geheim);

    const treffer = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM anmeldeversuche
       WHERE kennung::text LIKE ${"%" + geheim + "%"}
          OR coalesce(user_agent, '') LIKE ${"%" + geheim + "%"}`;
    expect(treffer[0]!.n).toBe(0);

    await db()`DELETE FROM anmeldeversuche WHERE kennung = ${kennung}`;
  });
});
