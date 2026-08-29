/**
 * Prüft am laufenden Schema, ob die eingebauten Schutzregeln wirklich greifen.
 * Kein Ersatz für die Testsuite (kommt in AP3/AP5), sondern eine schnelle
 * Kontrolle nach dem Migrationslauf: eine Regel, die man nur hinschreibt und
 * nie auslöst, ist eine Vermutung.
 *
 * Räumt am Ende alles wieder weg.
 */

import "dotenv/config";
import { db, schliesseDb, warteAufDb } from "../db/client.js";

let fehler = 0;
const sql = db();

async function pruefe(was: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  OK   ${was}`);
  } catch (e) {
    fehler++;
    console.log(`  FEHL ${was}\n       ${e instanceof Error ? e.message : e}`);
  }
}

/** Eine Prüfung, die auf einer bereits benutzten Datenbank nichts aussagt. */
function uebersprungen(was: string, grund: string): void {
  console.log(`  ---  ${was}
       übersprungen: ${grund}`);
}

/** Erwartet, dass die Anweisung von der Datenbank abgelehnt wird. */
async function mussScheitern(was: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    fehler++;
    console.log(`  FEHL ${was}\n       wurde NICHT abgelehnt`);
  } catch {
    console.log(`  OK   ${was}`);
  }
}

await warteAufDb(3, 1000);
console.log("\nSchemaprüfung\n");

// ── Reste früherer Läufe entfernen ─────────────────────────────────────────
// Bricht ein Lauf mittendrin ab, bleiben Prüfgerät UND dessen Buchungen
// liegen. Die Buchungen lassen sich wegen der Unveränderlichkeitsregel nicht
// löschen — und das Gerät dann auch nicht, weil die Buchungen darauf zeigen.
// Ohne diesen Griff wäre das Skript nach einem Abbruch dauerhaft rot.
// (Beim Prüfen des Pakets genau so passiert.)
await sql`DROP RULE IF EXISTS buchungen_kein_delete ON buchungen`;
await sql`DROP RULE IF EXISTS buchungen_kein_update ON buchungen`;
await sql`
  DELETE FROM buchungen
   WHERE geraet_id IN (SELECT id FROM geraete WHERE bezeichnung = 'PRUEF-Testgerät')`;
await sql`CREATE RULE buchungen_kein_update AS ON UPDATE TO buchungen DO INSTEAD NOTHING`;
await sql`CREATE RULE buchungen_kein_delete AS ON DELETE TO buchungen DO INSTEAD NOTHING`;

await sql`DELETE FROM etikettennummern
           WHERE geraet_id IN (SELECT id FROM geraete WHERE bezeichnung = 'PRUEF-Testgerät')`;
await sql`DELETE FROM geraete WHERE bezeichnung = 'PRUEF-Testgerät'`;
await sql`DELETE FROM lagerplaetze WHERE bezeichnung LIKE 'PRUEF-%'`;
await sql`DELETE FROM benutzer WHERE benutzername = 'pruef-konto'`;
await sql`DELETE FROM rollen WHERE id = 'pruef-rolle'`;

// ── Ist die Datenbank jungfräulich? ────────────────────────────────────────
// MUSS vor der Vorbereitung stehen: Die legt selbst ein Gerät an, und die
// Zählung hielte danach jede frische Datenbank für benutzt.
//
// Konten zählen mit: Der dokumentierte Installationsweg legt ERST das
// Verwaltungskonto an und ruft DANN diese Prüfung (docs/BETRIEB.md). Ohne
// die Konten in der Zählung galt die Datenbank dabei noch als frisch, und
// die Prüfung "der Seed legt kein Konto an" fand das eben angelegte Konto
// und meldete einen Mangel. Jede Erstinstallation sah so eine rote Zeile.
// Ob der Seed ein Konto anlegt, lässt sich ohnehin nur an einer wirklich
// unbenutzten Datenbank beantworten.
const [benutzt] = await sql<{ n: number }[]>`
  SELECT ((SELECT count(*) FROM geraete)
        + (SELECT count(*) FROM buchungen)
        + (SELECT count(*) FROM benutzer WHERE benutzername <> 'pruef-konto'))::int AS n`;
const frischeDb = (benutzt?.n ?? 0) === 0;

// ── Vorbereitung ───────────────────────────────────────────────────────────
const [konto] = await sql<{ id: string }[]>`
  INSERT INTO benutzer (benutzername, passwort_hash, anzeigename, rolle)
  VALUES ('pruef-konto', 'nicht-echt', 'Prüfkonto', 'verwaltung')
  RETURNING id`;
const [geraet] = await sql<{ id: string }[]>`
  INSERT INTO geraete (inventarnummer, bezeichnung)
  VALUES ('99999', 'PRUEF-Testgerät') RETURNING id`;
const [lager] = await sql<{ id: string }[]>`
  SELECT id FROM standorte WHERE typ = 'lager' LIMIT 1`;

if (!konto || !geraet || !lager) throw new Error("Vorbereitung fehlgeschlagen");

// ── Startdaten ─────────────────────────────────────────────────────────────
// Diese drei Prüfungen gelten NUR auf einer frisch migrierten Datenbank —
// sie kontrollieren, was der Seed anlegt (und vor allem, was er NICHT
// anlegt). Auf einer benutzten Datenbank sind sie wertlos und würden nur
// drei rote Zeilen erzeugen, die nach kaputtem Schema aussehen.
if (!frischeDb) {
  uebersprungen("Seed-Prüfungen (3)", "die Datenbank ist bereits in Benutzung");
}

if (frischeDb) await pruefe("Seed hat genau einen Lager-Standort angelegt", async () => {
  const [z] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM standorte WHERE typ='lager'`;
  if (z?.n !== 1) throw new Error(`erwartet 1 Lager, gefunden ${z?.n}`);
});

if (frischeDb) await pruefe("Seed hat KEIN Benutzerkonto angelegt", async () => {
  const [z] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM benutzer WHERE benutzername <> 'pruef-konto'`;
  if (z?.n !== 0) throw new Error(`erwartet 0 Konten, gefunden ${z?.n}`);
});

if (frischeDb) await pruefe("Seed gibt weder Schlagworte noch Prüfarten vor", async () => {
  const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM schlagworte`;
  const [p] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pruefarten`;
  if (s?.n !== 0 || p?.n !== 0) throw new Error(`Schlagworte ${s?.n}, Prüfarten ${p?.n}`);
});

// ── Getrennter Nummernkreis ────────────────────────────────────────────────
await mussScheitern("Lagerplatz-Barcode ohne Präfix 'P-' wird abgelehnt", () =>
  sql`INSERT INTO lagerplaetze (standort_id, bezeichnung, barcode)
      VALUES (${lager.id}, 'PRUEF-ohne-Praefix', '10042')`);

await pruefe("Lagerplatz-Barcode mit 'P-' wird angenommen", async () => {
  await sql`INSERT INTO lagerplaetze (standort_id, bezeichnung, barcode)
            VALUES (${lager.id}, 'PRUEF-Regal', 'P-9999')`;
});

await mussScheitern("Geräte-Barcode mit Präfix 'P-' wird abgelehnt", () =>
  sql`INSERT INTO geraete_barcodes (barcode, geraet_id) VALUES ('P-0001', ${geraet.id})`);

await pruefe("Geräte-Barcode als reine Ziffernfolge wird angenommen", async () => {
  await sql`INSERT INTO geraete_barcodes (barcode, geraet_id) VALUES ('99999', ${geraet.id})`;
});

await mussScheitern("Barcode ist unabhängig von Groß-/Kleinschreibung eindeutig (CITEXT)", () =>
  sql`INSERT INTO lagerplaetze (standort_id, bezeichnung, barcode)
      VALUES (${lager.id}, 'PRUEF-Regal2', 'p-9999')`);

await pruefe("Ein Gerät kann mehrere Etiketten tragen", async () => {
  await sql`INSERT INTO geraete_barcodes (barcode, geraet_id) VALUES ('99998', ${geraet.id})`;
  const [z] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM geraete_barcodes WHERE geraet_id = ${geraet.id}`;
  if (z?.n !== 2) throw new Error(`erwartet 2 Etiketten, gefunden ${z?.n}`);
});

await mussScheitern("Unerlaubter Gerätestatus wird abgelehnt", () =>
  sql`UPDATE geraete SET status = 'irgendwas' WHERE id = ${geraet.id}`);

// ── Die wichtigste Prüfung: Historie ist unveränderlich ────────────────────
const [buchung] = await sql<{ id: string }[]>`
  INSERT INTO buchungen (geraet_id, art, nach_standort_id, erfasst_von, notiz)
  VALUES (${geraet.id}, 'ausgabe', ${lager.id}, ${konto.id}, 'ursprünglich')
  RETURNING id`;
if (!buchung) throw new Error("Buchung konnte nicht angelegt werden");

await pruefe("UPDATE auf eine Buchung bleibt wirkungslos", async () => {
  await sql`UPDATE buchungen SET notiz = 'nachträglich geändert' WHERE id = ${buchung.id}`;
  const [nachher] = await sql<{ notiz: string }[]>`
    SELECT notiz FROM buchungen WHERE id = ${buchung.id}`;
  if (nachher?.notiz !== "ursprünglich") {
    throw new Error(`Notiz wurde zu "${nachher?.notiz}" — Historie ist manipulierbar!`);
  }
});

await pruefe("DELETE auf eine Buchung bleibt wirkungslos", async () => {
  await sql`DELETE FROM buchungen WHERE id = ${buchung.id}`;
  const [z] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM buchungen WHERE id = ${buchung.id}`;
  if (z?.n !== 1) throw new Error("Buchung wurde gelöscht — Historie ist lückenhaft!");
});

await mussScheitern("Gerät mit Buchungshistorie lässt sich nicht löschen", () =>
  sql`DELETE FROM geraete WHERE id = ${geraet.id}`);

await mussScheitern("Standort mit Buchungshistorie lässt sich nicht löschen", () =>
  sql`DELETE FROM standorte WHERE id = ${lager.id}`);

await pruefe("Standort lässt sich stattdessen stilllegen", async () => {
  await sql`UPDATE standorte SET aktiv = FALSE WHERE id = ${lager.id}`;
  await sql`UPDATE standorte SET aktiv = TRUE  WHERE id = ${lager.id}`;
});

// ── Rollen und Rechte (AP10) ───────────────────────────────────────────────

await pruefe("Die drei mitgelieferten Rollen stehen in der Datenbank", async () => {
  const zeilen = await sql<{ id: string; ist_vorgabe: boolean; rechte: string[] }[]>`
    SELECT id, ist_vorgabe, rechte FROM rollen ORDER BY sort_order`;
  const ids = zeilen.map((z) => z.id);
  for (const erwartet of ["mitarbeiter", "lager", "verwaltung"]) {
    if (!ids.includes(erwartet)) throw new Error(`Rolle "${erwartet}" fehlt`);
  }
  const verwaltung = zeilen.find((z) => z.id === "verwaltung")!;
  if (!verwaltung.rechte.includes("benutzer.verwalten")) {
    throw new Error("Die Verwaltung hat kein Recht auf Benutzerverwaltung — niemand käme mehr hinein");
  }
  if (!zeilen.every((z) => z.ist_vorgabe)) {
    throw new Error("Eine mitgelieferte Rolle ist nicht als Vorgabe gekennzeichnet und damit löschbar");
  }
});

await mussScheitern("Konto mit erfundener Rolle wird abgewiesen", () =>
  sql`UPDATE benutzer SET rolle = 'gibtsnicht' WHERE id = ${konto.id}`);

// Bewusst gegen eine EIGENS angelegte Rolle, nicht gegen "verwaltung":
// Greift der Fremdschlüssel nicht — also genau im Fehlerfall, den diese
// Prüfung sucht — würde das DELETE durchgehen und eine echte Vorgabe-Rolle
// vernichten. Ein Prüfskript darf im Fehlerfall keinen Schaden anrichten.
// (Beim Prüfen des Pakets genau so passiert: Die Gegenprobe hat die Rolle
// "verwaltung" gelöscht und die Datenbank unbrauchbar gemacht.)
await sql`
  INSERT INTO rollen (id, name, rechte, ist_vorgabe, sort_order)
  VALUES ('pruef-rolle', 'Prüfrolle', '{}', FALSE, 99)
  ON CONFLICT (id) DO NOTHING`;
await sql`UPDATE benutzer SET rolle = 'pruef-rolle' WHERE id = ${konto.id}`;

await mussScheitern("Eine Rolle, die jemand trägt, lässt sich nicht löschen", () =>
  sql`DELETE FROM rollen WHERE id = 'pruef-rolle'`);

await pruefe("Eine Rolle, die niemand trägt, lässt sich löschen", async () => {
  await sql`UPDATE benutzer SET rolle = 'verwaltung' WHERE id = ${konto.id}`;
  await sql`DELETE FROM rollen WHERE id = 'pruef-rolle'`;
  const [z] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM rollen WHERE id = 'pruef-rolle'`;
  if (z?.n !== 0) throw new Error("Prüfrolle blieb stehen");
});

// ── Nummernregister ────────────────────────────────────────────────────────

await pruefe("Der Bestand steht vollständig im Nummernregister", async () => {
  // Das eigene Prüfgerät ausgenommen: Es wird hier per rohem SQL angelegt,
  // also bewusst am Register vorbei — sonst meldete diese Prüfung sich selbst.
  const [fehlt] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM geraete g
     WHERE g.inventarnummer IS NOT NULL
       AND g.id <> ${geraet.id}
       AND NOT EXISTS (SELECT 1 FROM etikettennummern e WHERE e.nummer = g.inventarnummer)`;
  if ((fehlt?.n ?? 0) > 0) {
    throw new Error(
      `${fehlt!.n} Gerätenummer(n) fehlen im Register — sie könnten erneut vergeben werden`,
    );
  }
});

await pruefe("Auch jedes Etikett steht im Register", async () => {
  const [fehlt] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM geraete_barcodes b
     WHERE b.geraet_id <> ${geraet.id}
       AND NOT EXISTS (SELECT 1 FROM etikettennummern e WHERE e.nummer = b.barcode)`;
  if ((fehlt?.n ?? 0) > 0) throw new Error(`${fehlt!.n} Etikett(en) fehlen im Register`);
});

// Die Prüfung bringt ihre eigene Zeile mit, statt eine vorhandene zu
// verdoppeln. Vorher stand hier `INSERT ... SELECT ... LIMIT 1`: Auf einer
// frischen Anlage ist das Register leer, der SELECT traf null Zeilen, der
// INSERT lief ohne Fehler durch — und die Prüfung meldete "wurde NICHT
// abgelehnt", obwohl sie in Wahrheit gar nichts geprüft hatte.
await sql`INSERT INTO etikettennummern (nummer, zustand) VALUES ('PRUEF-88888', 'gesehen')`;
await mussScheitern("Dieselbe Nummer lässt sich nicht zweimal eintragen", () =>
  sql`INSERT INTO etikettennummern (nummer, zustand) VALUES ('PRUEF-88888', 'gesehen')`);

await mussScheitern("Ein erfundener Zustand wird abgelehnt", () =>
  sql`INSERT INTO etikettennummern (nummer, zustand) VALUES ('PRUEF-99999', 'irgendwas')`);

// ── Aufräumen ──────────────────────────────────────────────────────────────
await sql`DELETE FROM etikettennummern WHERE nummer LIKE 'PRUEF-%'`;
// Buchungen lassen sich weder ändern noch löschen — genau das ist ja der
// Zweck. Zum Aufräumen müssen beide Regeln kurz weichen: das Löschen der
// Zeile löst wegen der Selbstreferenz storniert_durch intern auch ein
// UPDATE aus.
await sql`DROP RULE IF EXISTS buchungen_kein_delete ON buchungen`;
await sql`DROP RULE IF EXISTS buchungen_kein_update ON buchungen`;
await sql`DELETE FROM buchungen WHERE geraet_id = ${geraet.id}`;
await sql`CREATE RULE buchungen_kein_update AS ON UPDATE TO buchungen DO INSTEAD NOTHING`;
await sql`CREATE RULE buchungen_kein_delete AS ON DELETE TO buchungen DO INSTEAD NOTHING`;
await sql`DELETE FROM etikettennummern WHERE geraet_id = ${geraet.id}`;
await sql`DELETE FROM geraete WHERE id = ${geraet.id}`;
await sql`DELETE FROM lagerplaetze WHERE bezeichnung LIKE 'PRUEF-%'`;
await sql`DELETE FROM benutzer WHERE id = ${konto.id}`;

console.log(
  fehler === 0 ? "\nAlle Schutzregeln greifen.\n" : `\n${fehler} Prüfung(en) fehlgeschlagen.\n`,
);
await schliesseDb();
process.exit(fehler === 0 ? 0 : 1);
