/**
 * Der Wächter über die Wächter.
 *
 * Dieser Test geht ALLE registrierten Routen durch und prüft: Antwortet
 * etwas ohne Anmeldung, obwohl es nicht in der Ausnahmeliste steht?
 *
 * Der Sinn: Beim Hinzufügen einer Route denkt niemand zuverlässig an den
 * Schutz. Hier fällt es sofort auf — ohne dass jemand daran denken muss,
 * einen Test dafür zu schreiben.
 */

import { afterAll, describe, expect, it } from "vitest";
import { app, OFFEN } from "../src/api/server.js";
import { schliesseDb } from "../src/db/client.js";

afterAll(async () => {
  await schliesseDb();
});

/** Alle bei Hono registrierten Pfade unter /api. */
function registriertePfade(): { methode: string; pfad: string }[] {
  return app.routes
    .filter((r) => r.path.startsWith("/api") && r.method !== "ALL")
    .map((r) => ({ methode: r.method, pfad: r.path }))
    .filter((r, i, alle) => alle.findIndex((x) => x.pfad === r.pfad && x.methode === r.methode) === i);
}

/** Platzhalter durch etwas Gültiges ersetzen, damit die Route überhaupt greift. */
function beispielPfad(pfad: string): string {
  return pfad.replace(/:[a-zA-Z]+/g, "00000000-0000-0000-0000-000000000000");
}

describe("Standard ist gesperrt", () => {
  it("registriert überhaupt Routen (sonst prüft dieser Test nichts)", () => {
    expect(registriertePfade().length).toBeGreaterThan(3);
  });

  it("hält die Ausnahmeliste kurz", () => {
    // Jeder Eintrag hier ist dem ganzen Internet zugänglich. Wächst die
    // Liste, soll das auffallen und begründet werden.
    expect(OFFEN.size).toBeLessThanOrEqual(3);
    expect([...OFFEN]).toEqual(["/api/health", "/api/auth/login"]);
  });

  it("weist JEDE Route ohne Ausnahmeeintrag ohne Anmeldung ab", async () => {
    const ungeschuetzt: string[] = [];

    for (const { methode, pfad } of registriertePfade()) {
      if (OFFEN.has(pfad)) continue;

      const antwort = await app.request(beispielPfad(pfad), {
        method: methode === "ALL" ? "GET" : methode,
        headers: { "Content-Type": "application/json" },
        ...(methode === "POST" || methode === "PATCH" || methode === "PUT"
          ? { body: "{}" }
          : {}),
      });

      // 401 = korrekt abgewiesen. 404 ist ebenfalls in Ordnung: die Route
      // existiert unter diesem Beispielpfad nicht. Alles andere bedeutet,
      // dass ohne Anmeldung etwas passiert ist.
      if (antwort.status !== 401 && antwort.status !== 404) {
        ungeschuetzt.push(`${methode} ${pfad} → ${antwort.status}`);
      }
    }

    expect(ungeschuetzt).toEqual([]);
  });
});

describe("Die offenen Endpunkte", () => {
  it("liefert /api/health ohne Anmeldung", async () => {
    const antwort = await app.request("/api/health");
    expect(antwort.status).toBe(200);
  });

  it("verrät über /api/health nichts über das Innenleben", async () => {
    // Der Endpunkt ist anonym erreichbar. Version, Datenbankzustand oder
    // Laufzeit hülfen nur jemandem beim Ausspähen.
    const koerper = (await (await app.request("/api/health")).json()) as Record<string, unknown>;
    expect(Object.keys(koerper)).toEqual(["ok"]);
  });
});

describe("Unbekannte Endpunkte", () => {
  it("antworten unter /api mit JSON statt mit HTML", async () => {
    const antwort = await app.request("/api/gibt-es-nicht");
    expect(antwort.headers.get("content-type")).toContain("application/json");
    expect([401, 404]).toContain(antwort.status);
  });
});

describe("Sicherheits-Kopfzeilen", () => {
  it("setzt eine erzwingende Inhaltsrichtlinie, keine bloß berichtende", async () => {
    const antwort = await app.request("/api/health");
    expect(antwort.headers.get("content-security-policy")).toBeTruthy();
    expect(antwort.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("verbietet das Einbetten in fremde Seiten", async () => {
    const kopf = (await app.request("/api/health")).headers;
    expect(kopf.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(kopf.get("x-frame-options")).toBe("DENY");
  });

  it("erlaubt WebAssembly, weil der Barcode-Leser es braucht", async () => {
    const csp = (await app.request("/api/health")).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("'wasm-unsafe-eval'");
  });

  it("erlaubt die Kamera nur der eigenen Seite", async () => {
    const kopf = (await app.request("/api/health")).headers.get("permissions-policy") ?? "";
    expect(kopf).toContain("camera=(self)");
  });
});
