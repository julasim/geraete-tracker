/**
 * Import und Export gegen die echte Datenbank.
 *
 * Die wichtigste Zusicherung, die hier geprüft wird: Die Vorschau schreibt
 * NICHTS. Darauf beruht, dass man ihr eine Datei anvertrauen kann.
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

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  await schliesseDb();
});

/** Schickt eine CSV-Datei an einen Endpunkt — wie ein Browser es täte. */
async function sendeDatei(pfad: string, sitzung: Sitzung, inhalt: string | Uint8Array) {
  const formular = new FormData();
  const bytes = typeof inhalt === "string" ? new TextEncoder().encode(inhalt) : inhalt;
  formular.append("datei", new File([bytes], "bestand.csv", { type: "text/csv" }));

  const antwort = await mitCookie(pfad, sitzung.cookie, { method: "POST", body: formular });
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

async function anzahlGeraete(): Promise<number> {
  const [z] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM geraete WHERE bezeichnung LIKE 'TEST-%'`;
  return z!.n;
}

describe("Vorschau schreibt nichts", () => {
  it("legt beim Prüfen keine Geräte an", async () => {
    const vorher = await anzahlGeraete();

    const { status, daten } = await sendeDatei(
      "/api/import/geraete/pruefen",
      admin,
      "Bezeichnung\r\nTEST-Import Bohrhammer\r\nTEST-Import Trennschleifer\r\n",
    );

    expect(status).toBe(200);
    expect((daten as { neu: number }).neu).toBe(2);
    // Das ist die Zusicherung, auf der alles beruht.
    expect(await anzahlGeraete()).toBe(vorher);
  });

  it("meldet Fehler, ohne etwas zu schreiben", async () => {
    const vorher = await anzahlGeraete();
    const { daten } = await sendeDatei(
      "/api/import/geraete/pruefen",
      admin,
      "Bezeichnung;Anschaffungswert\r\nTEST-Gut;100\r\n;ohne Bezeichnung\r\n",
    );
    expect((daten as { fehler: number; schreibbar: boolean }).fehler).toBe(1);
    expect((daten as { schreibbar: boolean }).schreibbar).toBe(false);
    expect(await anzahlGeraete()).toBe(vorher);
  });
});

describe("Import schreibt alles oder nichts", () => {
  it("legt Geräte an und vergibt Nummern", async () => {
    const { status, daten } = await sendeDatei(
      "/api/import/geraete",
      admin,
      "Bezeichnung;Hersteller\r\nTEST-Neu Eins;Hilti\r\nTEST-Neu Zwei;Bosch\r\n",
    );
    expect(status).toBe(200);
    expect((daten as { angelegt: number }).angelegt).toBe(2);

    const zeilen = await db()<{ inventarnummer: string; hersteller: string }[]>`
      SELECT inventarnummer, hersteller FROM geraete
       WHERE bezeichnung IN ('TEST-Neu Eins', 'TEST-Neu Zwei') ORDER BY bezeichnung`;
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]!.inventarnummer).toMatch(/^\d{5}$/);
    expect(zeilen[0]!.hersteller).toBe("Hilti");
  });

  it("schreibt gar nichts, wenn eine einzige Zeile fehlerhaft ist", async () => {
    const vorher = await anzahlGeraete();
    const { status } = await sendeDatei(
      "/api/import/geraete",
      admin,
      "Bezeichnung;Anschaffungswert\r\n" +
        "TEST-Wird nicht angelegt 1;100\r\n" +
        "TEST-Wird nicht angelegt 2;200\r\n" +
        "TEST-Kaputt;ca. dreitausend\r\n",
    );
    expect(status).toBe(409);
    // Auch die beiden guten Zeilen davor dürfen nicht geschrieben sein.
    expect(await anzahlGeraete()).toBe(vorher);
  });

  it("legt neue Schlagworte gleich mit an", async () => {
    await sendeDatei(
      "/api/import/geraete",
      admin,
      "Bezeichnung;Schlagworte\r\nTEST-Mit Wort;TEST-Erdbau, TEST-Mietgerät\r\n",
    );
    const worte = await db()<{ name: string }[]>`
      SELECT name FROM schlagworte WHERE name LIKE 'TEST-%' ORDER BY name`;
    expect(worte.map((w) => w.name)).toContain("TEST-Erdbau");
  });
});

describe("Unvollständige Zeilen", () => {
  it("legt ein Gerät an, das nur eine Bezeichnung hat", async () => {
    const { status, daten } = await sendeDatei(
      "/api/import/geraete",
      admin,
      "Bezeichnung\r\nTEST-Nur Bezeichnung\r\n",
    );
    expect(status).toBe(200);
    expect((daten as { angelegt: number }).angelegt).toBe(1);

    const [g] = await db()<{ hersteller: string | null }[]>`
      SELECT hersteller FROM geraete WHERE bezeichnung = 'TEST-Nur Bezeichnung'`;
    expect(g!.hersteller).toBeNull();
  });
});

describe("Leere Zelle löscht nichts", () => {
  it("lässt einen vorhandenen Hersteller stehen", async () => {
    // Anlegen mit Hersteller …
    await sendeDatei(
      "/api/import/geraete",
      admin,
      "Inventarnummer;Bezeichnung;Hersteller\r\n96001;TEST-Behalten;Wacker Neuson\r\n",
    );

    // … dann dieselbe Nummer erneut, aber mit leerer Herstellerzelle.
    const { status } = await sendeDatei(
      "/api/import/geraete",
      admin,
      "Inventarnummer;Bezeichnung;Hersteller\r\n96001;TEST-Behalten;\r\n",
    );
    expect(status).toBe(200);

    const [g] = await db()<{ hersteller: string | null }[]>`
      SELECT hersteller FROM geraete WHERE inventarnummer = '96001'`;
    expect(g!.hersteller).toBe("Wacker Neuson");
  });

  it("löscht einen Wert bei einem Bindestrich", async () => {
    await sendeDatei(
      "/api/import/geraete",
      admin,
      "Inventarnummer;Bezeichnung;Hersteller\r\n96002;TEST-Loeschen;Hilti\r\n",
    );
    await sendeDatei(
      "/api/import/geraete",
      admin,
      "Inventarnummer;Bezeichnung;Hersteller\r\n96002;TEST-Loeschen;-\r\n",
    );

    const [g] = await db()<{ hersteller: string | null }[]>`
      SELECT hersteller FROM geraete WHERE inventarnummer = '96002'`;
    expect(g!.hersteller).toBeNull();
  });
});

describe("Standort und Zustand", () => {
  it("bleiben unangetastet, auch wenn sie in der Datei stehen", async () => {
    await sendeDatei(
      "/api/import/geraete",
      admin,
      "Inventarnummer;Bezeichnung\r\n96003;TEST-Ortstest\r\n",
    );

    const { daten } = await sendeDatei(
      "/api/import/geraete/pruefen",
      admin,
      "Inventarnummer;Bezeichnung;Status (nur Information);Standort (nur Information)\r\n" +
        "96003;TEST-Ortstest;ausgegeben;Irgendeine Baustelle\r\n",
    );

    // Die Zeile gilt als unverändert — die Zustandsspalten zählen nicht.
    expect((daten as { unveraendert: number }).unveraendert).toBe(1);
    // Und der Benutzer wird darauf hingewiesen.
    expect((daten as { hinweise: string[] }).hinweise.join(" ")).toMatch(/Standort und Zustand/);

    const [g] = await db()<{ status: string; aktueller_standort_id: string | null }[]>`
      SELECT status, aktueller_standort_id FROM geraete WHERE inventarnummer = '96003'`;
    expect(g!.status).toBe("verfuegbar");
    expect(g!.aktueller_standort_id).toBeNull();
  });
});

describe("Dateien aus Excel", () => {
  it("versteht Windows-1252 mit Umlauten", async () => {
    // Genau das schreibt Excel im deutschen Sprachraum beim Speichern als CSV.
    const text = "Bezeichnung;Hersteller\r\nTEST-Rüttelplatte groß;Wacker\r\n";
    const win1252: number[] = [];
    for (const zeichen of text) {
      const code = zeichen.codePointAt(0)!;
      // ü = 0xFC, ö = 0xF6, ä = 0xE4, ß = 0xDF in Windows-1252
      win1252.push(code < 256 ? code : 0x3f);
    }
    const { status, daten } = await sendeDatei(
      "/api/import/geraete",
      admin,
      new Uint8Array(win1252),
    );
    expect(status).toBe(200);
    expect((daten as { angelegt: number }).angelegt).toBe(1);

    const [g] = await db()<{ bezeichnung: string }[]>`
      SELECT bezeichnung FROM geraete WHERE bezeichnung LIKE 'TEST-R%ttelplatte gro%'`;
    expect(g!.bezeichnung).toBe("TEST-Rüttelplatte groß");
  });

  it("versteht Komma als Trennzeichen", async () => {
    const { status } = await sendeDatei(
      "/api/import/geraete",
      admin,
      "Bezeichnung,Hersteller\r\nTEST-Mit Komma,Bosch\r\n",
    );
    expect(status).toBe(200);
    const [g] = await db()<{ hersteller: string }[]>`
      SELECT hersteller FROM geraete WHERE bezeichnung = 'TEST-Mit Komma'`;
    expect(g!.hersteller).toBe("Bosch");
  });

  it("versteht deutsche Zahlen und Daten", async () => {
    await sendeDatei(
      "/api/import/geraete",
      admin,
      "Bezeichnung;Anschaffungswert;Anschaffungsdatum\r\nTEST-Deutsche Werte;1.234,50;31.03.2026\r\n",
    );
    const [g] = await db()<{ anschaffungswert: string; anschaffungsdatum: string }[]>`
      SELECT anschaffungswert, anschaffungsdatum FROM geraete
       WHERE bezeichnung = 'TEST-Deutsche Werte'`;
    expect(Number(g!.anschaffungswert)).toBe(1234.5);
    // Das Datum darf beim Speichern keinen Tag verlieren.
    expect(String(g!.anschaffungsdatum)).toContain("2026-03-31");
  });
});

describe("Export", () => {
  it("liefert eine Datei, die Excel richtig öffnet", async () => {
    const antwort = await mitCookie("/api/export/geraete.csv", admin.cookie);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("text/csv");
    expect(antwort.headers.get("content-disposition")).toContain("attachment");

    // Über die rohen Bytes prüfen: Response.text() entfernt ein BOM beim
    // Dekodieren automatisch — Excel tut das nicht, und genau darum geht es.
    const bytes = new Uint8Array(await antwort.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);

    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain("Inventarnummer;Bezeichnung");
    // Die Fassungsnummer muss mit, sonst ist kein Konfliktschutz möglich.
    expect(csv).toContain("Fassung");
    // Zustandsspalten sind als solche gekennzeichnet.
    expect(csv).toContain("(nur Information)");
  });

  it("lässt sich exportieren, verändern und wieder importieren", async () => {
    await sendeDatei(
      "/api/import/geraete",
      admin,
      "Inventarnummer;Bezeichnung\r\n96010;TEST-Rundlauf\r\n",
    );

    const csv = await (await mitCookie("/api/export/geraete.csv", admin.cookie)).text();
    const geaendert = csv.replace("TEST-Rundlauf", "TEST-Rundlauf geändert");

    const { status, daten } = await sendeDatei("/api/import/geraete", admin, geaendert);
    expect(status).toBe(200);
    expect((daten as { geaendert: number }).geaendert).toBeGreaterThanOrEqual(1);

    const [g] = await db()<{ bezeichnung: string }[]>`
      SELECT bezeichnung FROM geraete WHERE inventarnummer = '96010'`;
    expect(g!.bezeichnung).toBe("TEST-Rundlauf geändert");
  });
});

describe("Rechte", () => {
  it("lässt Mitarbeiter nicht exportieren", async () => {
    const antwort = await mitCookie("/api/export/geraete.csv", mitarbeiter.cookie);
    expect(antwort.status).toBe(403);
  });

  it("lässt Mitarbeiter nicht importieren", async () => {
    const { status } = await sendeDatei(
      "/api/import/geraete",
      mitarbeiter,
      "Bezeichnung\r\nTEST-Verboten\r\n",
    );
    expect(status).toBe(403);
  });
});
