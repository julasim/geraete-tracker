/**
 * Buchungen gegen die Datenbank — Regeln, Historie, Unveränderlichkeit
 * und der Fall zweier gleichzeitiger Scans.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { mitCookie } from "./helpers/konten.js";
import {
  alsAdmin,
  alsMitarbeiter,
  raeumeKontenAuf,
  raeumeTestdatenAuf,
  type Sitzung,
} from "./helpers/stammdaten.js";

let admin: Sitzung;
let mitarbeiter: Sitzung;
let lagerId: string;
let baustelleId: string;
let zweiteBaustelleId: string;
let regalId: string;

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();

  lagerId = (await erstelle("/api/standorte", { name: "TEST-Bauhof", typ: "lager" })).id;
  baustelleId = (await erstelle("/api/standorte", { name: "TEST-Lindengasse", typ: "baustelle" })).id;
  zweiteBaustelleId = (await erstelle("/api/standorte", { name: "TEST-Ahornweg", typ: "baustelle" })).id;
  regalId = (
    await erstelle("/api/lagerplaetze", { standort_id: lagerId, bezeichnung: "TEST-Regal A1" })
  ).id;
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  await schliesseDb();
});

async function sende(pfad: string, sitzung: Sitzung, methode: string, koerper?: unknown) {
  const antwort = await mitCookie(pfad, sitzung.cookie, {
    method: methode,
    headers: { "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

async function erstelle(pfad: string, koerper: unknown): Promise<{ id: string }> {
  const { status, daten } = await sende(pfad, admin, "POST", koerper);
  if (status !== 201) throw new Error(`${pfad}: Status ${status} — ${JSON.stringify(daten)}`);
  return daten as { id: string };
}

async function neuesGeraet(): Promise<{ id: string; inventarnummer: string }> {
  return (await erstelle("/api/geraete", {
    bezeichnung: "TEST-Rüttelplatte",
    standort_id: lagerId,
  })) as { id: string; inventarnummer: string };
}

const ausgeben = (geraetId: string, extra: Record<string, unknown> = {}) =>
  sende("/api/buchungen", mitarbeiter, "POST", {
    geraet_id: geraetId,
    art: "ausgabe",
    nach_standort_id: baustelleId,
    empfaenger_id: mitarbeiter.konto.id,
    ...extra,
  });

const zuruecknehmen = (geraetId: string, extra: Record<string, unknown> = {}) =>
  sende("/api/buchungen", mitarbeiter, "POST", {
    geraet_id: geraetId,
    art: "ruecknahme",
    nach_standort_id: lagerId,
    ...extra,
  });

describe("Ausgeben und Zurücknehmen", () => {
  it("gibt ein Gerät aus und setzt Zustand, Ort und Nutzer", async () => {
    const geraet = await neuesGeraet();
    const { status, daten } = await ausgeben(geraet.id);
    expect(status).toBe(201);

    const g = (daten as { geraet: { status: string; standort: string; nutzer: string } }).geraet;
    expect(g.status).toBe("ausgegeben");
    expect(g.standort).toBe("TEST-Lindengasse");
    expect(g.nutzer).toBeTruthy();
  });

  it("nimmt es zurück und stellt es wieder in den Bestand", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    const { status, daten } = await zuruecknehmen(geraet.id, { nach_lagerplatz_id: regalId });
    expect(status).toBe(201);

    const g = (daten as { geraet: { status: string; nutzer: string | null; lagerplatz: string } })
      .geraet;
    expect(g.status).toBe("verfuegbar");
    expect(g.nutzer).toBeNull(); // niemand hat es mehr
    expect(g.lagerplatz).toBe("TEST-Regal A1");
  });

  it("bucht auf eine andere Baustelle um", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    const { status, daten } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "umbuchung",
      nach_standort_id: zweiteBaustelleId,
      empfaenger_id: mitarbeiter.konto.id,
    });
    expect(status).toBe(201);
    expect((daten as { geraet: { standort: string } }).geraet.standort).toBe("TEST-Ahornweg");
  });

  it("lässt jeden Mitarbeiter buchen — sonst wird gar nicht gebucht", async () => {
    const geraet = await neuesGeraet();
    expect((await ausgeben(geraet.id)).status).toBe(201);
  });
});

describe("Regeln, die den Bestand schützen", () => {
  it("verweigert das doppelte Ausgeben", async () => {
    const geraet = await neuesGeraet();
    expect((await ausgeben(geraet.id)).status).toBe(201);

    const zweitesMal = await ausgeben(geraet.id);
    expect(zweitesMal.status).toBe(409);
    expect((zweitesMal.daten as { error: string }).error).toMatch(/bereits ausgegeben/i);
  });

  it("verweigert die Rücknahme eines Geräts, das im Lager steht", async () => {
    const geraet = await neuesGeraet();
    const { status } = await zuruecknehmen(geraet.id);
    expect(status).toBe(409);
  });

  it("verlangt ein Ziel beim Ausgeben", async () => {
    const geraet = await neuesGeraet();
    const { status, daten } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ausgabe",
      empfaenger_id: mitarbeiter.konto.id,
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/wohin/i);
  });

  it("verlangt einen Empfänger beim Ausgeben", async () => {
    const geraet = await neuesGeraet();
    const { status, daten } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ausgabe",
      nach_standort_id: baustelleId,
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/wer/i);
  });

  it("nimmt einen Subunternehmer ohne Konto als Freitext an", async () => {
    const geraet = await neuesGeraet();
    const { status, daten } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_freitext: "Fa. Huber, Hr. Mayer",
    });
    expect(status).toBe(201);
    expect((daten as { buchung: { empfaenger: string } }).buchung.empfaenger).toBe(
      "Fa. Huber, Hr. Mayer",
    );
  });

  it("verweigert das Umbuchen auf denselben Standort", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    const { status } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "umbuchung",
      nach_standort_id: baustelleId, // schon dort
      empfaenger_id: mitarbeiter.konto.id,
    });
    expect(status).toBe(409);
  });

  it("verweigert einen Lagerplatz, der zu einem anderen Standort gehört", async () => {
    // Sonst stünde das Gerät laut Bestand in einem Regal, das ganz woanders ist.
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    const { status, daten } = await zuruecknehmen(geraet.id, {
      nach_standort_id: baustelleId,
      nach_lagerplatz_id: regalId, // Regal steht aber im Bauhof
    });
    expect(status).toBe(409);
    expect((daten as { error: string }).error).toMatch(/anderen Standort/i);
  });

  it("meldet ein Gerät, das es nicht gibt, mit 404", async () => {
    const { status } = await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: "00000000-0000-0000-0000-000000000000",
      art: "ausgabe",
      nach_standort_id: baustelleId,
      empfaenger_id: mitarbeiter.konto.id,
    });
    expect(status).toBe(404);
  });
});

describe("Ausfallschaden", () => {
  it("sperrt das Gerät bei der Rücknahme sofort", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    const { daten } = await zuruecknehmen(geraet.id, { ausfall: true, notiz: "Motor defekt" });
    expect((daten as { geraet: { status: string } }).geraet.status).toBe("defekt");
  });

  it("verhindert danach das erneute Ausgeben", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    await zuruecknehmen(geraet.id, { ausfall: true });

    const nochmal = await ausgeben(geraet.id);
    expect(nochmal.status).toBe(409);
    expect((nochmal.daten as { error: string }).error).toMatch(/defekt/i);
  });
});

describe("Historie", () => {
  it("hält jeden Schritt in der richtigen Reihenfolge fest", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    await sende("/api/buchungen", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      art: "umbuchung",
      nach_standort_id: zweiteBaustelleId,
      empfaenger_id: mitarbeiter.konto.id,
    });
    await zuruecknehmen(geraet.id);

    const { status, daten } = await sende(`/api/geraete/${geraet.id}/historie`, mitarbeiter, "GET");
    expect(status).toBe(200);

    const zeilen = daten as { art: string; erfasser: string }[];
    expect(zeilen).toHaveLength(3);
    expect(zeilen.map((z) => z.art)).toEqual(["ruecknahme", "umbuchung", "ausgabe"]); // neueste zuerst
    expect(zeilen.every((z) => z.erfasser)).toBe(true); // wer gebucht hat, steht immer dabei
  });

  it("lässt sich nicht nachträglich ändern", async () => {
    // Die Datenbank verweigert UPDATE per Regel. Der Test prüft, dass die
    // Regel auch nach allen Migrationen noch steht.
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    const [zeile] = await db()<{ id: string; notiz: string | null }[]>`
      SELECT id, notiz FROM buchungen WHERE geraet_id = ${geraet.id}`;

    await db()`UPDATE buchungen SET notiz = 'nachträglich verändert' WHERE id = ${zeile!.id}`;

    const [danach] = await db()<{ notiz: string | null }[]>`
      SELECT notiz FROM buchungen WHERE id = ${zeile!.id}`;
    expect(danach!.notiz).toBe(zeile!.notiz);
  });

  it("lässt sich nicht löschen", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    await db()`DELETE FROM buchungen WHERE geraet_id = ${geraet.id}`;

    const [zahl] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM buchungen WHERE geraet_id = ${geraet.id}`;
    expect(zahl!.n).toBe(1);
  });

  it("meldet die Historie eines Geräts, das es nicht gibt, mit 404", async () => {
    const { status } = await sende(
      "/api/geraete/00000000-0000-0000-0000-000000000000/historie",
      mitarbeiter,
      "GET",
    );
    expect(status).toBe(404);
  });
});

describe("Zwei gleichzeitige Scans", () => {
  it("sperrt die Gerätezeile während der Buchung wirklich", async () => {
    // Der reale Fall: zwei Leute scannen dasselbe Gerät im selben Moment.
    // Ohne SELECT ... FOR UPDATE läsen beide "verfuegbar" und beide gäben
    // aus — das Gerät stünde danach an zwei Orten.
    //
    // Über zwei gleichzeitige HTTP-Anfragen ist das NICHT prüfbar: sie laufen
    // im selben Prozess und kommen sich in der Praxis nicht ins Gehege — der
    // Test bliebe auch dann grün, wenn die Sperre fehlte (nachgemessen).
    // Deshalb hier direkt auf Datenbankebene, mit NOWAIT: Ist die Zeile
    // gesperrt, meldet Postgres das sofort, statt zu warten.
    const geraet = await neuesGeraet();
    let zweiteWurdeAbgewiesen = false;

    await db().begin(async (tx1) => {
      await tx1`SELECT id FROM geraete WHERE id = ${geraet.id} FOR UPDATE`;

      // Zweite Verbindung, während die erste die Zeile hält.
      try {
        await db().begin(async (tx2) => {
          await tx2`SELECT id FROM geraete WHERE id = ${geraet.id} FOR UPDATE NOWAIT`;
        });
      } catch (fehler) {
        // 55P03 = lock_not_available: genau das erwartete Verhalten.
        zweiteWurdeAbgewiesen = (fehler as { code?: string }).code === "55P03";
      }
    });

    expect(zweiteWurdeAbgewiesen).toBe(true);
  });

  it("lässt von zwei Ausgaben desselben Geräts nur eine durch", async () => {
    const geraet = await neuesGeraet();

    const [erste, zweite] = await Promise.all([ausgeben(geraet.id), ausgeben(geraet.id)]);
    expect([erste.status, zweite.status].sort()).toEqual([201, 409]);

    // Und genau EINE Zeile ist in der Historie gelandet.
    const [zahl] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM buchungen WHERE geraet_id = ${geraet.id}`;
    expect(zahl!.n).toBe(1);
  });

  it("hinterlässt bei einem abgewiesenen Versuch keine halbe Buchung", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);

    const abgewiesen = await ausgeben(geraet.id); // scheitert an der Regel
    expect(abgewiesen.status).toBe(409);

    const [zahl] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM buchungen WHERE geraet_id = ${geraet.id}`;
    expect(zahl!.n).toBe(1); // nur die erste, erfolgreiche
  });
});

describe("Berichtigen", () => {
  it("lässt den Admin einen falschen Zustand geradeziehen", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);

    const { status, daten } = await sende("/api/buchungen/korrektur", admin, "POST", {
      geraet_id: geraet.id,
      neuer_status: "verfuegbar",
      nach_standort_id: lagerId,
      begruendung: "Gerät stand schon seit Montag im Lager, Rücknahme wurde vergessen.",
    });
    expect(status).toBe(201);
    expect((daten as { geraet: { status: string } }).geraet.status).toBe("verfuegbar");
  });

  it("verlangt eine Begründung", async () => {
    const geraet = await neuesGeraet();
    const { status } = await sende("/api/buchungen/korrektur", admin, "POST", {
      geraet_id: geraet.id,
      neuer_status: "verfuegbar",
      begruendung: "",
    });
    expect(status).toBe(400);
  });

  it("lässt Mitarbeiter nicht berichtigen", async () => {
    const geraet = await neuesGeraet();
    const { status } = await sende("/api/buchungen/korrektur", mitarbeiter, "POST", {
      geraet_id: geraet.id,
      neuer_status: "verfuegbar",
      begruendung: "will ich aber",
    });
    expect(status).toBe(403);
  });

  it("löscht die falsche Buchung nicht, sondern ergänzt sie", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    await sende("/api/buchungen/korrektur", admin, "POST", {
      geraet_id: geraet.id,
      neuer_status: "verfuegbar",
      begruendung: "Fehlbuchung",
    });

    const { daten } = await sende(`/api/geraete/${geraet.id}/historie`, admin, "GET");
    const zeilen = daten as { art: string }[];
    expect(zeilen).toHaveLength(2);
    expect(zeilen.map((z) => z.art)).toEqual(["korrektur", "ausgabe"]);
  });
});

describe("Was gerade draußen ist", () => {
  it("listet ausgegebene Geräte mit Dauer und Empfänger", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);

    const { status, daten } = await sende("/api/buchungen/offen", mitarbeiter, "GET");
    expect(status).toBe(200);

    const zeile = (daten as { geraet_id: string; tage: number; empfaenger: string }[]).find(
      (z) => z.geraet_id === geraet.id,
    );
    expect(zeile).toBeTruthy();
    expect(zeile!.tage).toBe(0);
    expect(zeile!.empfaenger).toBeTruthy();
  });

  it("führt zurückgenommene Geräte nicht mehr auf", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id);
    await zuruecknehmen(geraet.id);

    const { daten } = await sende("/api/buchungen/offen", mitarbeiter, "GET");
    expect((daten as { geraet_id: string }[]).some((z) => z.geraet_id === geraet.id)).toBe(false);
  });

  it("erkennt eine überschrittene Rückgabefrist", async () => {
    const geraet = await neuesGeraet();
    await ausgeben(geraet.id, { geplante_rueckgabe: "2020-01-01" });

    const { daten } = await sende("/api/buchungen/offen", mitarbeiter, "GET");
    const zeile = (daten as { geraet_id: string; ueberfaellig: boolean }[]).find(
      (z) => z.geraet_id === geraet.id,
    );
    expect(zeile!.ueberfaellig).toBe(true);
  });
});
