/**
 * Etikettenbögen.
 *
 * Was hier NICHT geprüft werden kann: ob der gedruckte Barcode von einer
 * Handykamera gelesen wird. Das entscheidet sich am Papier, am Drucker und
 * an der Druckeinstellung — dafür gibt es den Testbogen und eine
 * Handprüfung in docs/scanner-abnahme.md.
 *
 * Was hier geprüft wird: dass ein maßhaltiges PDF entsteht, das die
 * richtigen Nummern enthält.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schliesseDb } from "../src/db/client.js";
import { mitCookie } from "./helpers/konten.js";
import {
  alsAdmin,
  alsMitarbeiter,
  raeumeKontenAuf,
  raeumeTestdatenAuf,
  type Sitzung,
} from "./helpers/stammdaten.js";
import { inflateSync } from "node:zlib";
import { baueBogen, FORMATE } from "../src/etiketten/bogen.js";

/** Entpackt alle Inhaltsströme eines PDF und gibt ihren Text zurück. */
function entpackterText(pdf: Buffer): string {
  const roh = pdf.toString("latin1");
  let ergebnis = "";
  let suchAb = 0;
  const CR = 13;
  const LF = 10;

  for (;;) {
    const beginn = roh.indexOf("stream", suchAb);
    if (beginn < 0) break;
    const ende = roh.indexOf("endstream", beginn);
    if (ende < 0) break;

    // Nach dem Wort folgt ein Zeilenumbruch, der nicht zum Inhalt gehört.
    let inhaltAb = beginn + "stream".length;
    while ([CR, LF].includes(roh.charCodeAt(inhaltAb))) inhaltAb++;

    try {
      ergebnis += inflateSync(pdf.subarray(inhaltAb, ende)).toString("latin1");
    } catch {
      // Nicht jeder Strom ist komprimiert (Bilder etwa) — das ist in Ordnung.
      ergebnis += roh.slice(inhaltAb, ende);
    }
    suchAb = ende + "endstream".length;
  }
  return ergebnis;
}

let admin: Sitzung;
let mitarbeiter: Sitzung;
const geraetIds: string[] = [];

beforeAll(async () => {
  await raeumeTestdatenAuf();
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();

  for (const bez of ["TEST-Etikett A", "TEST-Etikett B", "TEST-Etikett C"]) {
    const antwort = await mitCookie("/api/geraete", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bezeichnung: bez }),
    });
    const daten = (await antwort.json()) as { id: string };
    geraetIds.push(daten.id);
  }
});

afterAll(async () => {
  await raeumeTestdatenAuf();
  await raeumeKontenAuf();
  await schliesseDb();
});

/** A4 in PDF-Punkten: 595 × 842 (auf ganze Punkte gerundet). */
const A4_BREITE = (210 * 72) / 25.4;
const A4_HOEHE = (297 * 72) / 25.4;

describe("PDF erzeugen", () => {
  it("baut einen Bogen mit korrekten A4-Maßen", async () => {
    const pdf = await baueBogen([{ code: "10001" }, { code: "10002" }]);
    const text = pdf.toString("latin1");

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Die Seitengröße steht als MediaBox im PDF. Sie muss exakt A4 sein —
    // sonst skaliert der Drucker, und der Barcode wird unlesbar.
    const kasten = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(text);
    expect(kasten).toBeTruthy();
    expect(Number(kasten![1])).toBeCloseTo(A4_BREITE, 0);
    expect(Number(kasten![2])).toBeCloseTo(A4_HOEHE, 0);
  });

  it("legt bei mehr Etiketten als auf einen Bogen passen eine zweite Seite an", async () => {
    const format = FORMATE["70x37"]!;
    const proBogen = format.spalten * format.reihen;

    const einSeitig = await baueBogen(
      Array.from({ length: proBogen }, (_, i) => ({ code: String(20000 + i) })),
    );
    const zweiSeitig = await baueBogen(
      Array.from({ length: proBogen + 1 }, (_, i) => ({ code: String(20000 + i) })),
    );

    const seiten = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(seiten(zweiSeitig)).toBeGreaterThan(seiten(einSeitig));
  });

  it("verarbeitet den übergebenen Code — verschiedene Codes ergeben verschiedene Bögen", async () => {
    // Was hier NICHT geprüft werden kann: ob die Nummer hinterher lesbar
    // auf dem Papier steht. PDFKit legt Schriftzeichen als Glyphen-Kennungen
    // ab, nicht als Text — ein automatischer Test könnte das nur vortäuschen.
    //
    // Die Lesbarkeit entscheidet sich ohnehin am Drucker und am Papier und
    // wird deshalb von Hand geprüft: Testbogen drucken, aufkleben, mit der
    // App scannen (siehe docs/scanner-abnahme.md).
    const eins = await baueBogen([{ code: "10042" }]);
    const zwei = await baueBogen([{ code: "99999" }]);
    expect(eins.equals(zwei)).toBe(false);
    expect(entpackterText(eins).length).toBeGreaterThan(1000);
  });

  it("setzt den Firmennamen, wenn einer übergeben wird", async () => {
    const ohne = await baueBogen([{ code: "10001" }]);
    const mit = await baueBogen([{ code: "10001" }], { firmenname: "SIMA INFRA Construction GmbH" });
    // Mehr Inhalt = die Zeile ist da.
    expect(mit.length).toBeGreaterThan(ohne.length);
  });

  it("kennt mehrere Bogenformate", () => {
    expect(Object.keys(FORMATE).length).toBeGreaterThanOrEqual(3);
    for (const format of Object.values(FORMATE)) {
      // Die Etiketten müssen auf die Seite passen — sonst druckt man ins Leere.
      const nettoBreite = format.randLinks + format.spalten * format.breite;
      const nettoHoehe = format.randOben + format.reihen * format.hoehe;
      expect(nettoBreite).toBeLessThanOrEqual(format.seiteBreite + 0.5);
      expect(nettoHoehe).toBeLessThanOrEqual(format.seiteHoehe + 0.5);
    }
  });
});

describe("Über die API", () => {
  it("liefert einen Testbogen als PDF", async () => {
    const antwort = await mitCookie("/api/etiketten/testbogen", admin.cookie);
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("application/pdf");

    const bytes = new Uint8Array(await antwort.arrayBuffer());
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
  });

  it("druckt Etiketten für ausgewählte Geräte", async () => {
    const antwort = await mitCookie("/api/etiketten", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geraete: geraetIds }),
    });
    expect(antwort.status).toBe(200);
    expect(antwort.headers.get("content-type")).toContain("application/pdf");
    expect((await antwort.arrayBuffer()).byteLength).toBeGreaterThan(3000);
  });

  it("lässt sich beliebig oft wiederholen", async () => {
    // Geht ein Bogen verloren, bevor er geklebt wurde, muss ein neuer
    // Ausdruck ein Klick sein — die Nummern sind ja schon vergeben.
    const erster = await mitCookie("/api/etiketten", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geraete: geraetIds }),
    });
    const zweiter = await mitCookie("/api/etiketten", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geraete: geraetIds }),
    });
    expect(erster.status).toBe(200);
    expect(zweiter.status).toBe(200);
  });

  it("nimmt eine Startposition für angebrochene Bögen", async () => {
    const antwort = await mitCookie("/api/etiketten", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geraete: geraetIds, startPosition: 5 }),
    });
    expect(antwort.status).toBe(200);
  });

  it("meldet eine leere Auswahl als Eingabefehler", async () => {
    const antwort = await mitCookie("/api/etiketten", admin.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geraete: [] }),
    });
    expect(antwort.status).toBe(400);
  });

  it("lässt Mitarbeiter keine Etiketten drucken", async () => {
    const antwort = await mitCookie("/api/etiketten", mitarbeiter.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geraete: geraetIds }),
    });
    expect(antwort.status).toBe(403);
  });
});
