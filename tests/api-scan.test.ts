/**
 * Der Scan-Endpunkt. Der meistgenutzte der App — und der einzige, den ein
 * Mitarbeiter auf der Baustelle bewusst wahrnimmt.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { entsperre, legeKontoAn, meldeAn, raeumeKontoAuf, mitCookie } from "./helpers/konten.js";
import type { TestKonto } from "./helpers/konten.js";
import {
  alsAdmin,
  alsMitarbeiter,
  raeumeKontenAuf,
  raeumeTestdatenAuf,
  type Sitzung,
} from "./helpers/stammdaten.js";

let admin: Sitzung;
let mitarbeiter: Sitzung;
/** Jemand ohne `buchungen.erfassen` — für die Rechteprüfung der Aktionsliste. */
let leser: Sitzung;
let leserKonto: TestKonto;
let lagerId: string;
let baustelleId: string;
let regalCode: string;

const LESER_ROLLE = "test-scan-leser";

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();
  leser = await alsLeser();

  lagerId = (await erstelle("/api/standorte", { name: "TEST-Bauhof", typ: "lager" })).id;
  baustelleId = (await erstelle("/api/standorte", { name: "TEST-Baustelle", typ: "baustelle" })).id;
  const regal = (await erstelle("/api/lagerplaetze", {
    standort_id: lagerId,
    bezeichnung: "TEST-Regal B2",
  })) as { id: string; barcode: string };
  regalCode = regal.barcode;
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  // Erst das Konto, dann die Rolle — der Fremdschlüssel benutzer.rolle
  // verhindert die umgekehrte Reihenfolge.
  if (leserKonto) await raeumeKontoAuf(leserKonto);
  await db()`DELETE FROM rollen WHERE id = ${LESER_ROLLE}`;
  await schliesseDb();
});

/**
 * Eine Sitzung mit einer Rolle ganz ohne Rechte.
 *
 * Die Rolle entsteht direkt in der Tabelle statt über `POST /rollen`: Was
 * hier geprüft wird, ist die Aktionsliste des Scans, nicht die
 * Rollenverwaltung — ein zweiter Endpunkt dazwischen wäre eine weitere
 * Stelle, an der der Test aus dem falschen Grund rot werden kann.
 */
async function alsLeser(): Promise<Sitzung> {
  await db()`
    INSERT INTO rollen (id, name, beschreibung, rechte)
    VALUES (${LESER_ROLLE}, 'Nur ansehen', 'Sieht den Bestand, bucht nicht.', '{}')
    ON CONFLICT (id) DO UPDATE SET rechte = '{}'`;
  leserKonto = await legeKontoAn({ rolle: LESER_ROLLE });
  await entsperre(leserKonto.id);
  const { cookie } = await meldeAn(leserKonto.benutzername, leserKonto.passwort);
  if (!cookie) throw new Error("Anmeldung des Lesers fehlgeschlagen");
  return { konto: leserKonto, cookie };
}

async function sende(pfad: string, sitzung: Sitzung, methode = "GET", koerper?: unknown) {
  const antwort = await mitCookie(pfad, sitzung.cookie, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

async function erstelle(pfad: string, koerper: unknown): Promise<Record<string, unknown>> {
  const { status, daten } = await sende(pfad, admin, "POST", koerper);
  if (status !== 201) throw new Error(`${pfad}: ${status} — ${JSON.stringify(daten)}`);
  return daten as Record<string, unknown>;
}

const scan = (code: string, sitzung: Sitzung) => sende(`/api/scan/${code}`, sitzung);

describe("Gerät scannen", () => {
  it("findet das Gerät und sagt, was damit möglich ist", async () => {
    const geraet = (await erstelle("/api/geraete", {
      bezeichnung: "TEST-Rüttelplatte",
      inventarnummer: "90013",
      standort_id: lagerId,
    })) as { id: string };

    const { status, daten } = await scan("90013", mitarbeiter);
    expect(status).toBe(200);

    const a = daten as {
      typ: string;
      geraet: { id: string; bezeichnung: string };
      aktionen: { art: string; hauptaktion: boolean }[];
      warnungen: unknown[];
    };
    expect(a.typ).toBe("geraet");
    expect(a.geraet.id).toBe(geraet.id);
    expect(a.aktionen.map((x) => x.art)).toContain("ausgabe");
    expect(a.warnungen).toEqual([]);
  });

  it("findet dasselbe Gerät auch bei Leerzeichen aus der Handeingabe", async () => {
    await erstelle("/api/geraete", { bezeichnung: "TEST-Stampfer", inventarnummer: "90021" });
    const { status, daten } = await scan("%2090021%20", mitarbeiter);
    expect(status).toBe(200);
    expect((daten as { typ: string }).typ).toBe("geraet");
  });

  it("bietet einem ausgegebenen Gerät Rücknahme statt Ausgabe an", async () => {
    const geraet = (await erstelle("/api/geraete", {
      bezeichnung: "TEST-Bagger",
      inventarnummer: "90031",
      standort_id: lagerId,
    })) as { id: string };

    await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_id: mitarbeiter.konto.id,
    });

    const { daten } = await scan("90031", mitarbeiter);
    const arten = (daten as { aktionen: { art: string }[] }).aktionen.map((a) => a.art);
    expect(arten).toContain("ruecknahme");
    expect(arten).not.toContain("ausgabe");
  });

  it("erklärt bei einem defekten Gerät, warum nichts geht", async () => {
    const geraet = (await erstelle("/api/geraete", {
      bezeichnung: "TEST-Kaputt",
      inventarnummer: "90041",
      standort_id: lagerId,
    })) as { id: string };

    await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_id: mitarbeiter.konto.id,
    });
    await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ruecknahme",
      nach_standort_id: lagerId,
      ausfall: true,
    });

    const { daten } = await scan("90041", mitarbeiter);
    const a = daten as { aktionen: unknown[]; hinweis: string };
    expect(a.aktionen).toHaveLength(0);
    expect(a.hinweis).toMatch(/Schaden|defekt/i);
  });

  it("liefert die letzte Buchung mit, damit die Karte sie zeigen kann", async () => {
    const geraet = (await erstelle("/api/geraete", {
      bezeichnung: "TEST-MitHistorie",
      inventarnummer: "90051",
      standort_id: lagerId,
    })) as { id: string };
    await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_id: mitarbeiter.konto.id,
    });

    const { daten } = await scan("90051", mitarbeiter);
    const letzte = (daten as { letzteBuchung: { art: string; erfasser: string } }).letzteBuchung;
    expect(letzte.art).toBe("ausgabe");
    expect(letzte.erfasser).toBeTruthy();
  });

  it("bietet niemandem mehr das Berichtigen an, auch dem Admin nicht", async () => {
    // Der Knopf hat nie funktioniert: Er schickte ein POST /buchungen mit
    // art "korrektur", und dessen Schema kennt nur ausgabe, ruecknahme und
    // umbuchung — die Antwort war 400. Berichtigt wird über
    // POST /buchungen/korrektur, mit Begründung.
    await erstelle("/api/geraete", { bezeichnung: "TEST-FuerAdmin", inventarnummer: "90061" });

    for (const sitzung of [mitarbeiter, admin]) {
      const { daten } = await scan("90061", sitzung);
      const arten = (daten as { aktionen: { art: string }[] }).aktionen.map((a) => a.art);
      expect(arten).not.toContain("korrektur");
    }
  });

  it("bietet ohne das Recht zu buchen gar keine Aktion an", async () => {
    // Am Handy erschienen die Buchungsknöpfe bisher für jeden Angemeldeten;
    // der Server wies sie danach mit 403 ab. Kein Loch, aber ein Knopf, der
    // für diesen Benutzer nie funktioniert.
    await erstelle("/api/geraete", {
      bezeichnung: "TEST-FuerLeser",
      inventarnummer: "90062",
      standort_id: lagerId,
    });

    const mitRecht = await scan("90062", mitarbeiter);
    const ohneRecht = await scan("90062", leser);

    expect(ohneRecht.status).toBe(200);
    // Lesen ist kein Recht: Das Gerät sieht er sehr wohl.
    expect((ohneRecht.daten as { geraet: { id: string } }).geraet.id).toBeTruthy();
    expect((ohneRecht.daten as { aktionen: unknown[] }).aktionen).toEqual([]);
    // Gegenstück, damit der Test nicht bloß beweist, dass die Liste immer
    // leer ist: Mit dem Recht steht "ausgabe" darin.
    expect((mitRecht.daten as { aktionen: { art: string }[] }).aktionen.map((a) => a.art)).toContain(
      "ausgabe",
    );
  });
});

describe("Lagerplatz scannen", () => {
  it("erkennt am Präfix, dass es ein Regal ist, und zeigt den Inhalt", async () => {
    const { status, daten } = await scan(regalCode, mitarbeiter);
    expect(status).toBe(200);

    const a = daten as { typ: string; lagerplatz: { bezeichnung: string }; geraete: unknown[] };
    expect(a.typ).toBe("lagerplatz");
    expect(a.lagerplatz.bezeichnung).toBe("TEST-Regal B2");
    expect(Array.isArray(a.geraete)).toBe(true);
  });

  it("zeigt die eingelagerten Geräte", async () => {
    const geraet = (await erstelle("/api/geraete", {
      bezeichnung: "TEST-ImRegal",
      inventarnummer: "90071",
      standort_id: lagerId,
    })) as { id: string };

    const regal = (await sende(`/api/lagerplaetze?standort=${lagerId}`, admin)).daten as {
      id: string;
      barcode: string;
    }[];
    const regalId = regal.find((r) => r.barcode === regalCode)!.id;

    await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_id: mitarbeiter.konto.id,
    });
    await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ruecknahme",
      nach_standort_id: lagerId,
      nach_lagerplatz_id: regalId,
    });

    const { daten } = await scan(regalCode, mitarbeiter);
    const inhalt = (daten as { geraete: { id: string }[] }).geraete;
    expect(inhalt.some((g) => g.id === geraet.id)).toBe(true);
  });
});

describe("Unbekannt und unbrauchbar", () => {
  it("meldet einen unbekannten Gerätecode mit 404 und nennt den Grund", async () => {
    const { status, daten } = await scan("99999", mitarbeiter);
    expect(status).toBe(404);
    const a = daten as { typ: string; grund: string; anlegbar: boolean };
    expect(a.typ).toBe("unbekannt");
    expect(a.grund).toBe("geraet_nicht_erfasst");
  });

  it("bietet dem Admin das Anlegen an, dem Mitarbeiter nicht", async () => {
    // Der Mitarbeiter auf der Baustelle soll nicht raten müssen.
    const alsMa = await scan("99998", mitarbeiter);
    const alsAd = await scan("99998", admin);
    expect((alsMa.daten as { anlegbar: boolean }).anlegbar).toBe(false);
    expect((alsMa.daten as { hinweis: string }).hinweis).toMatch(/Büro/i);
    expect((alsAd.daten as { anlegbar: boolean }).anlegbar).toBe(true);
  });

  it("unterscheidet ein unbekanntes Regal von einem unbekannten Gerät", async () => {
    const { daten } = await scan("P-9998", mitarbeiter);
    expect((daten as { grund: string }).grund).toBe("platz_nicht_erfasst");
  });

  it("weist einen unlesbaren Code freundlich ab", async () => {
    const { status, daten } = await scan("XYZ-kaputt", mitarbeiter);
    expect(status).toBe(404);
    const a = daten as { grund: string; hinweis: string };
    expect(a.grund).toBe("unlesbar");
    expect(a.hinweis).toMatch(/von Hand/i);
  });

  it("verlangt auch für das Scannen eine Anmeldung", async () => {
    const antwort = await mitCookie("/api/scan/10013", null);
    expect(antwort.status).toBe(401);
  });
});
