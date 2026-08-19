/**
 * Die Bremse gegen Passwortraten — der Kern der Anforderung
 * "niemand darf das Passwort einfach knacken können".
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { SPERRE_NACH_VERSUCHEN } from "../src/config.js";
import { schliesseDb } from "../src/db/client.js";
import { warteZeitMs, pruefeSperre } from "../src/api/bremse.js";
import { entsperre, legeKontoAn, meldeAn, raeumeKontoAuf } from "./helpers/konten.js";
import type { TestKonto } from "./helpers/konten.js";

const angelegte: TestKonto[] = [];

async function frischesKonto(): Promise<TestKonto> {
  const k = await legeKontoAn();
  angelegte.push(k);
  return k;
}

afterAll(async () => {
  for (const k of angelegte) await raeumeKontoAuf(k);
  await schliesseDb();
});

describe("Wartezeit", () => {
  it("bremst die ersten beiden Fehlversuche nicht", () => {
    // Wer sich vertippt, soll nichts merken.
    expect(warteZeitMs(0)).toBe(0);
    expect(warteZeitMs(1)).toBe(0);
    expect(warteZeitMs(2)).toBe(0);
  });

  it("verdoppelt sich mit jedem weiteren Fehlversuch", () => {
    expect(warteZeitMs(3)).toBe(1000);
    expect(warteZeitMs(4)).toBe(2000);
    expect(warteZeitMs(5)).toBe(4000);
    expect(warteZeitMs(6)).toBe(8000);
  });

  it("wächst nicht ins Unendliche", () => {
    // Sonst bliebe eine Anfrage minutenlang offen und belegte Ressourcen.
    expect(warteZeitMs(30)).toBe(8000);
    expect(warteZeitMs(500)).toBe(8000);
  });
});

describe("Sperrzustand", () => {
  it("erkennt ein nicht gesperrtes Konto", () => {
    expect(pruefeSperre(null).gesperrt).toBe(false);
  });

  it("erkennt eine abgelaufene Sperre als beendet", () => {
    expect(pruefeSperre(new Date(Date.now() - 60_000)).gesperrt).toBe(false);
  });

  it("erkennt eine laufende Sperre und nennt die Restzeit", () => {
    const stand = pruefeSperre(new Date(Date.now() + 300_000));
    expect(stand.gesperrt).toBe(true);
    expect(stand.bisSekunden).toBeGreaterThan(290);
  });
});

describe("Kontosperre greift wirklich", () => {
  let konto: TestKonto;

  beforeEach(async () => {
    konto = await frischesKonto();
    await entsperre(konto.id);
  });

  it(
    "sperrt das Konto nach der festgelegten Zahl von Fehlversuchen",
    async () => {
      let letzterStatus = 0;
      for (let i = 0; i < SPERRE_NACH_VERSUCHEN; i++) {
        const { status } = await meldeAn(konto.benutzername, "falsches-passwort-hier");
        letzterStatus = status;
      }
      // Der Versuch, der die Grenze erreicht, wird bereits mit 429 quittiert.
      expect(letzterStatus).toBe(429);

      // Und ab jetzt hilft auch das RICHTIGE Passwort nicht mehr — genau das
      // macht das Durchprobieren aussichtslos.
      const mitRichtigem = await meldeAn(konto.benutzername, konto.passwort);
      expect(mitRichtigem.status).toBe(429);
      expect(mitRichtigem.cookie).toBeNull();
    },
    120_000,
  );

  it(
    "lässt nach dem Entsperren wieder anmelden",
    async () => {
      for (let i = 0; i < SPERRE_NACH_VERSUCHEN; i++) {
        await meldeAn(konto.benutzername, "falsches-passwort-hier");
      }
      expect((await meldeAn(konto.benutzername, konto.passwort)).status).toBe(429);

      await entsperre(konto.id);
      const danach = await meldeAn(konto.benutzername, konto.passwort);
      expect(danach.status).toBe(200);
      expect(danach.cookie).toBeTruthy();
    },
    120_000,
  );

  it("setzt den Zähler nach erfolgreicher Anmeldung zurück", async () => {
    await meldeAn(konto.benutzername, "falsch-1");
    await meldeAn(konto.benutzername, "falsch-2");
    expect((await meldeAn(konto.benutzername, konto.passwort)).status).toBe(200);

    const { db } = await import("../src/db/client.js");
    const zeilen = await db()<{ fehlversuche: number }[]>`
      SELECT fehlversuche FROM benutzer WHERE id = ${konto.id}`;
    expect(zeilen[0]!.fehlversuche).toBe(0);
  });
});
