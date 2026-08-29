/**
 * Keine Etikettennummer darf zweimal hinausgehen.
 *
 * Julius' Vorgabe. Der teuerste Fehler dieser Anwendung wäre ein Etikett,
 * das zweimal klebt: Der Scan zeigt dann das falsche Gerät, und es fällt
 * erst auf, wenn jemand die Maschine sucht, die laut System auf einer
 * anderen Baustelle steht.
 *
 * Die Falle ist nicht der Druck, sondern die VERGABE: Solange die
 * Ersterfassung läuft, kleben draußen Etiketten, die das System nicht kennt.
 * Wer die nächste Nummer aus dem Höchstwert der erfassten Geräte ableitet,
 * trifft irgendwann eine davon.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { app } from "../src/api/server.js";
import { COOKIE_NAME } from "../src/api/auth.js";
import { hashePasswort } from "../src/domain/passwort.js";

const PASSWORT = "Kranfahrt-Ziegel-Winter-7742";
const angelegteKonten: string[] = [];
const angelegteGeraete: string[] = [];
/** Alles, was diese Datei ins Register schreibt, trägt diese Notiz. */
const MARKE = "TEST-NUMMERNREGISTER";
let cookie = "";

async function sende(pfad: string, methode: string, koerper?: unknown) {
  const antwort = await app.request(pfad, {
    method: methode,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
  const typ = antwort.headers.get("content-type") ?? "";
  return {
    status: antwort.status,
    kopf: antwort.headers,
    daten: typ.includes("json") ? await antwort.json().catch(() => null) : null,
  };
}

async function legeGeraetAn(daten: Record<string, unknown>) {
  const antwort = await sende("/api/geraete", "POST", daten);
  if (antwort.status === 201) angelegteGeraete.push((antwort.daten as { id: string }).id);
  return antwort;
}

beforeAll(async () => {
  const name = `test-nr-${Math.random().toString(36).slice(2, 10)}`;
  const [konto] = await db()<{ id: string }[]>`
    INSERT INTO benutzer (benutzername, passwort_hash, anzeigename, rolle, passwort_wechsel_noetig)
    VALUES (${name}, ${await hashePasswort(PASSWORT)}, ${"Test " + name}, 'verwaltung', FALSE)
    RETURNING id`;
  angelegteKonten.push(konto!.id);

  const anmeldung = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kennung: name, passwort: PASSWORT }),
  });
  const gesetzt = anmeldung.headers.get("set-cookie") ?? "";
  if (!gesetzt.includes(COOKIE_NAME)) throw new Error("Anmeldung fehlgeschlagen");
  cookie = gesetzt.split(";")[0]!;
}, 120_000);

afterAll(async () => {
  for (const id of angelegteGeraete) {
    await db()`DELETE FROM etikettennummern WHERE geraet_id = ${id}`;
    await db()`DELETE FROM geraete_barcodes WHERE geraet_id = ${id}`;
    await db()`DELETE FROM geraete WHERE id = ${id}`;
  }
  /**
   * ALLES wegräumen, was dieses Testkonto ins Register geschrieben hat —
   * Reservierungen, gesehene Nummern, Bereiche.
   *
   * Ohne das wächst der Nummernkreis der Entwicklungsdatenbank mit jedem
   * Testlauf um über hundert Nummern weiter. Nach ein paar Dutzend Läufen
   * stünde dort eine sechsstellige „nächste freie Nummer", und niemand
   * wüsste mehr, warum.
   */
  await db()`DELETE FROM etikettennummern WHERE erfasst_von = ANY(${angelegteKonten})`;
  await db()`DELETE FROM etikettennummern WHERE notiz LIKE ${MARKE + "%"}`;
  // Und die Geräte, die diese Datei über den Import angelegt hat (sie stehen
  // nicht in angelegteGeraete, weil der Import keine IDs zurückgibt).
  await db()`
    DELETE FROM etikettennummern
     WHERE geraet_id IN (SELECT id FROM geraete WHERE bezeichnung LIKE ${MARKE + "%"})`;
  await db()`
    DELETE FROM geraete_barcodes
     WHERE geraet_id IN (SELECT id FROM geraete WHERE bezeichnung LIKE ${MARKE + "%"})`;
  await db()`DELETE FROM geraete WHERE bezeichnung LIKE ${MARKE + "%"}`;
  for (const id of angelegteKonten) {
    await db()`DELETE FROM anmeldeversuche WHERE kennung IN (SELECT benutzername FROM benutzer WHERE id = ${id})`;
    await db()`DELETE FROM benutzer WHERE id = ${id}`;
  }
  await schliesseDb();
});

/**
 * Die Nummer, die die Anwendung als nächste vergeben würde.
 *
 * `hoechste: null` heißt: Das Register ist leer — eine frische Anlage. Die
 * Vergabe beginnt dann bei 10000 (`naechsteFreie` in `src/data/nummern.ts`),
 * die erste Nummer ist also 10001, nicht 00001.
 *
 * Diese Zeile fehlte zuerst, und der Test war trotzdem grün: Die
 * Entwicklungsdatenbank ist längst gewachsen, dort tritt der Fall nie auf.
 * Aufgefallen ist es erst in der Werkbank, die jedes Mal bei Null anfängt.
 */
async function naechste(): Promise<string> {
  const { daten } = await sende("/api/etiketten/nummern", "GET");
  const hoechste = (daten as { hoechste: string | null }).hoechste;
  const stand = hoechste === null ? 10_000 : Number(hoechste);
  return String(stand + 1).padStart(5, "0");
}

describe("Vorratsdruck", () => {
  it("reserviert die Nummern, bevor der Bogen herauskommt", async () => {
    const vorher = await naechste();

    const antwort = await sende("/api/etiketten/vorrat", "POST", { anzahl: 5 });
    expect(antwort.status).toBe(200);
    expect(antwort.kopf.get("content-type")).toContain("pdf");
    expect(antwort.kopf.get("X-Nummern-Von")).toBe(vorher);

    const bis = antwort.kopf.get("X-Nummern-Bis")!;
    expect(Number(bis) - Number(vorher)).toBe(4);

    // Alle fünf stehen als reserviert im Register.
    const [z] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM etikettennummern
       WHERE zustand = 'reserviert'
         AND (nummer)::text::bigint BETWEEN ${Number(vorher)} AND ${Number(bis)}`;
    expect(z?.n).toBe(5);
  }, 60_000);

  it("gibt dieselbe Nummer nie ein zweites Mal aus", async () => {
    const eins = await sende("/api/etiketten/vorrat", "POST", { anzahl: 3 });
    const zwei = await sende("/api/etiketten/vorrat", "POST", { anzahl: 3 });

    const endeErster = Number(eins.kopf.get("X-Nummern-Bis"));
    const startZweiter = Number(zwei.kopf.get("X-Nummern-Von"));
    expect(startZweiter).toBe(endeErster + 1);
  }, 60_000);

  it("hält auch bei gleichzeitigen Drucken auseinander", async () => {
    // Der Fall aus dem Bauhof: zwei Leute drucken im selben Moment.
    const laeufe = await Promise.all(
      Array.from({ length: 5 }, () => sende("/api/etiketten/vorrat", "POST", { anzahl: 4 })),
    );
    expect(laeufe.every((l) => l.status === 200)).toBe(true);

    const alle: number[] = [];
    for (const l of laeufe) {
      const von = Number(l.kopf.get("X-Nummern-Von"));
      for (let i = 0; i < 4; i++) alle.push(von + i);
    }
    expect(new Set(alle).size).toBe(20);
  }, 120_000);

  it("weist unsinnige Stückzahlen ab", async () => {
    expect((await sende("/api/etiketten/vorrat", "POST", { anzahl: 0 })).status).toBe(400);
    expect((await sende("/api/etiketten/vorrat", "POST", { anzahl: 5000 })).status).toBe(400);
  });
});

describe("Reservierte Nummern und die Geräteanlage", () => {
  it("vergibt eine reservierte Nummer NICHT an ein neues Gerät", async () => {
    const gedruckt = await sende("/api/etiketten/vorrat", "POST", { anzahl: 10 });
    const von = Number(gedruckt.kopf.get("X-Nummern-Von"));
    const bis = Number(gedruckt.kopf.get("X-Nummern-Bis"));

    // Jetzt ein Gerät ohne Nummernangabe anlegen — es muss OBERHALB des
    // gedruckten Bogens landen, nicht mitten hinein.
    const neu = await legeGeraetAn({ bezeichnung: `${MARKE} Automatisch` });
    expect(neu.status).toBe(201);

    // Keine der zehn gedruckten Nummern wird verbraten. Nicht "größer als
    // der Bogen" — parallel laufende Testdateien dürfen dazwischenkommen.
    const nummer = Number((neu.daten as { inventarnummer: string }).inventarnummer);
    expect(nummer >= von && nummer <= bis).toBe(false);
  }, 60_000);

  it("lässt eine reservierte Nummer aber ausdrücklich zu — dafür wurde sie gedruckt", async () => {
    const gedruckt = await sende("/api/etiketten/vorrat", "POST", { anzahl: 1 });
    const nummer = gedruckt.kopf.get("X-Nummern-Von")!;

    // Das Etikett klebt jetzt auf einer Maschine; sie wird erfasst.
    const neu = await legeGeraetAn({
      bezeichnung: `${MARKE} Vom Vorratsbogen`,
      inventarnummer: nummer,
    });
    expect(neu.status).toBe(201);
    expect((neu.daten as { inventarnummer: string }).inventarnummer).toBe(nummer);

    const [eintrag] = await db()<{ zustand: string; geraet_id: string }[]>`
      SELECT zustand, geraet_id FROM etikettennummern WHERE nummer = ${nummer}`;
    expect(eintrag?.zustand).toBe("vergeben");
    expect(eintrag?.geraet_id).toBe((neu.daten as { id: string }).id);
  }, 60_000);

  it("weist eine Nummer ab, die bereits an einem Gerät hängt", async () => {
    const erstes = await legeGeraetAn({ bezeichnung: `${MARKE} Erstes` });
    const nummer = (erstes.daten as { inventarnummer: string }).inventarnummer;

    const zweites = await legeGeraetAn({ bezeichnung: `${MARKE} Zweites`, inventarnummer: nummer });
    expect(zweites.status).toBe(409);
    expect((zweites.daten as { error: string }).error).toMatch(/vergeben|gehört bereits/i);
  }, 60_000);
});

describe("Altetiketten, die beim Scannen auftauchen", () => {
  it("merkt sich eine unbekannte Nummer und vergibt sie danach nicht mehr", async () => {
    // Eine Nummer WEIT oberhalb des laufenden Kreises: So ein Etikett klebt
    // draußen auf einer Maschine, die noch niemand erfasst hat.
    const hoch = String(Number(await naechste()) + 30).padStart(5, "0");

    const scan = await sende(`/api/scan/${hoch}`, "GET");
    expect(scan.status).toBe(404);
    expect((scan.daten as { grund: string }).grund).toBe("geraet_nicht_erfasst");

    // Der Scan schreibt nebenher — kurz Zeit lassen.
    await new Promise((r) => setTimeout(r, 300));

    const [eintrag] = await db()<{ zustand: string }[]>`
      SELECT zustand FROM etikettennummern WHERE nummer = ${hoch}`;
    expect(eintrag?.zustand).toBe("gesehen");

    // Und die automatische Vergabe trifft diese Nummer nicht mehr.
    const neu = await legeGeraetAn({ bezeichnung: `${MARKE} Nach dem Scan` });
    expect((neu.daten as { inventarnummer: string }).inventarnummer).not.toBe(hoch);
  }, 60_000);

  it("lässt genau dieses Gerät danach mit der gescannten Nummer erfassen", async () => {
    // Der Normalfall auf der Baustelle: scannen, "nicht erfasst", anlegen.
    const hoch = String(Number(await naechste()) + 40).padStart(5, "0");
    await sende(`/api/scan/${hoch}`, "GET");
    await new Promise((r) => setTimeout(r, 300));

    const neu = await legeGeraetAn({ bezeichnung: `${MARKE} Altbestand`, inventarnummer: hoch });
    expect(neu.status).toBe(201);
    expect((neu.daten as { inventarnummer: string }).inventarnummer).toBe(hoch);
  }, 60_000);
});

describe("Ein Vertipper darf den Nummernkreis nicht zerstören", () => {
  it("eine gescannte Fantasienummer verschiebt die Reihe nicht", async () => {
    /**
     * Der Fall, der beim Testlauf wirklich auftrat: Ein Scan von 99999 machte
     * die Nummer zu "gesehen" — und weil die Vergabe den Höchstwert des
     * REGISTERS nahm, sprang die nächste Nummer auf 100000. Ab da wäre jedes
     * Etikett sechsstellig gewesen, wegen eines Tippfehlers bei der
     * Handeingabe. Gegengeprüft: ohne den Schutz vergibt die Anwendung
     * 16140 statt 11138.
     *
     * Zwei getrennte Fragen: Wo steht die Reihe (nur vergeben/reserviert)
     * und ist DIESE Nummer frei (jeder Eintrag zählt).
     */
    const vorher = await naechste();

    /**
     * Die Nummer wird RELATIV zum aktuellen Stand gewählt, nicht fest als
     * "99999" hingeschrieben: Läge der Kreis darüber, prüfte der Test nichts
     * — beim Bauen genau so passiert, die Gegenprobe blieb grün, weil die
     * feste Nummer unterhalb des Kreises lag.
     */
    const weitOben = String(Number(vorher) + 5000);
    const nochWeiter = String(Number(vorher) + 5001);

    await sende(`/api/scan/${weitOben}`, "GET");
    await sende(`/api/scan/${nochWeiter}`, "GET");
    await new Promise((r) => setTimeout(r, 300));

    // Registriert — die Nummern sind blockiert …
    const [gesehen] = await db()<{ n: number }[]>`
      SELECT count(*)::int AS n FROM etikettennummern
       WHERE nummer IN (${weitOben}, ${nochWeiter}) AND zustand = 'gesehen'`;
    expect(gesehen?.n).toBe(2);

    // … aber die Reihe steht unverändert.
    expect(await naechste()).toBe(vorher);

    const neu = await legeGeraetAn({ bezeichnung: `${MARKE} Nach dem Vertipper` });
    expect((neu.daten as { inventarnummer: string }).inventarnummer).toBe(vorher);
  }, 60_000);

  it("überspringt trotzdem eine gescannte Nummer, die als nächste käme", async () => {
    // Die andere Hälfte: Klebt genau die nächste Nummer schon draußen,
    // muss die Vergabe darüber hinweg.
    const dran = await naechste();
    await sende(`/api/scan/${dran}`, "GET");
    await new Promise((r) => setTimeout(r, 300));

    const neu = await legeGeraetAn({ bezeichnung: `${MARKE} Übersprungen` });
    const bekommen = (neu.daten as { inventarnummer: string }).inventarnummer;
    expect(bekommen).not.toBe(dran);
    expect(Number(bekommen)).toBe(Number(dran) + 1);
  }, 60_000);
});

describe("Altbestand als Bereich eintragen", () => {
  it("sperrt einen ganzen Nummernbereich für die Vergabe", async () => {
    const start = Number(await naechste()) + 100;
    const ende = start + 20;

    const antwort = await sende("/api/etiketten/altbestand", "POST", {
      von: String(start),
      bis: String(ende),
    });
    expect(antwort.status).toBe(200);
    expect((antwort.daten as { eingetragen: number }).eingetragen).toBe(21);

    const neu = await legeGeraetAn({ bezeichnung: `${MARKE} Nach dem Bereich` });
    const vergeben = Number((neu.daten as { inventarnummer: string }).inventarnummer);
    expect(vergeben >= start && vergeben <= ende).toBe(false);
  }, 60_000);

  it("weist einen unsinnig großen Bereich ab", async () => {
    const antwort = await sende("/api/etiketten/altbestand", "POST", {
      von: "10000",
      bis: "99999",
    });
    expect(antwort.status).toBe(400);
  });
});

describe("Import", () => {
  it("greift keine Nummer ab, die auf einem Vorratsbogen steht", async () => {
    // Der wichtigste Weg für die Ersterfassung — und die Stelle, an der die
    // Absicherung zuerst leckte: Der Import las den Höchstwert aus der
    // Gerätetabelle statt aus dem Register.
    const gedruckt = await sende("/api/etiketten/vorrat", "POST", { anzahl: 8 });
    const von = Number(gedruckt.kopf.get("X-Nummern-Von"));
    const bis = Number(gedruckt.kopf.get("X-Nummern-Bis"));

    // Zeilenenden über Zeichencodes: Escape-Sequenzen überleben den Weg
    // durch die Werkzeugkette hier nicht zuverlässig.
    const CRLF = String.fromCharCode(13, 10);
    const csv =
      `Bezeichnung${CRLF}${MARKE} Import A${CRLF}${MARKE} Import B${CRLF}`;
    const grenze = "----Register" + von;
    const koerper =
      `--${grenze}${CRLF}` +
      `Content-Disposition: form-data; name="datei"; filename="import.csv"${CRLF}` +
      `Content-Type: text/csv${CRLF}${CRLF}` +
      csv +
      `${CRLF}--${grenze}--${CRLF}`;

    const antwort = await app.request("/api/import/geraete", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": `multipart/form-data; boundary=${grenze}` },
      body: koerper,
    });
    expect(antwort.status).toBe(200);

    const neue = await db()<{ inventarnummer: string; id: string }[]>`
      SELECT id, inventarnummer FROM geraete WHERE bezeichnung LIKE ${MARKE + " Import%"}`;
    expect(neue.length).toBe(2);
    /**
     * Geprüft wird genau die Zusicherung — keine importierte Nummer liegt im
     * reservierten Bereich. Bewusst NICHT "größer als der Bogen": Die
     * Testdateien laufen parallel gegen dieselbe Datenbank, und eine andere
     * darf zwischendurch Nummern verbrauchen, ohne diesen Test zu kippen.
     */
    for (const g of neue) {
      angelegteGeraete.push(g.id);
      const n = Number(g.inventarnummer);
      expect(n >= von && n <= bis).toBe(false);
    }
  }, 120_000);
});

describe("Ersatzetiketten", () => {
  it("ziehen den laufenden Nummernkreis nicht mit nach oben", async () => {
    // Ein Ersatzetikett aus einem ganz anderen Bereich — im Bauhof kommt so
    // etwas von einer alten Rolle. Es muss belegt sein, darf die Vergabe
    // aber nicht von 10120 auf 90001 springen lassen.
    const geraet = await legeGeraetAn({ bezeichnung: `${MARKE} Mit Ersatzetikett` });
    const id = (geraet.daten as { id: string }).id;
    const vorher = await naechste();

    const ersatz = await sende(`/api/geraete/${id}/barcodes`, "POST", { barcode: "90001" });
    expect(ersatz.status).toBe(201);

    // Die nächste Nummer bleibt im laufenden Kreis …
    expect(await naechste()).toBe(vorher);

    // … aber 90001 ist verbraucht.
    const zweites = await legeGeraetAn({ bezeichnung: `${MARKE} Klaut 90001`, barcode: "90001" });
    expect(zweites.status).toBe(409);
  }, 60_000);
});
