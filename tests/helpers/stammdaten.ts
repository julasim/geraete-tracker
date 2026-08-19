/**
 * Hilfen für Stammdaten-Tests: angemeldete Sitzungen und Aufräumen.
 */

import { db } from "../../src/db/client.js";
import { entsperre, legeKontoAn, meldeAn, raeumeKontoAuf } from "./konten.js";
import type { TestKonto } from "./konten.js";

export interface Sitzung {
  konto: TestKonto;
  cookie: string;
}

const angelegte: TestKonto[] = [];

export async function alsAdmin(): Promise<Sitzung> {
  return anmelden("verwaltung");
}

export async function alsMitarbeiter(): Promise<Sitzung> {
  return anmelden("mitarbeiter");
}

async function anmelden(rolle: string): Promise<Sitzung> {
  const konto = await legeKontoAn({ rolle });
  angelegte.push(konto);
  await entsperre(konto.id);
  const { cookie } = await meldeAn(konto.benutzername, konto.passwort);
  if (!cookie) throw new Error("Anmeldung im Test fehlgeschlagen");
  return { konto, cookie };
}

/** Entfernt alle in diesem Lauf angelegten Konten. */
export async function raeumeKontenAuf(): Promise<void> {
  for (const k of angelegte) await raeumeKontoAuf(k);
  angelegte.length = 0;
}

/**
 * Entfernt Testdaten. Buchungen lassen sich nicht löschen (das ist so
 * gewollt) — für Tests müssen die Schutzregeln deshalb kurz weichen.
 */
export async function raeumeTestdatenAuf(kennung = "TEST-"): Promise<void> {
  const sql = db();
  await sql`DROP RULE IF EXISTS buchungen_kein_delete ON buchungen`;
  await sql`DROP RULE IF EXISTS buchungen_kein_update ON buchungen`;
  await sql`
    DELETE FROM buchungen WHERE geraet_id IN (
      SELECT id FROM geraete WHERE bezeichnung LIKE ${kennung + "%"})`;
  await sql`CREATE RULE buchungen_kein_update AS ON UPDATE TO buchungen DO INSTEAD NOTHING`;
  await sql`CREATE RULE buchungen_kein_delete AS ON DELETE TO buchungen DO INSTEAD NOTHING`;

  await sql`DELETE FROM geraete WHERE bezeichnung LIKE ${kennung + "%"}`;
  await sql`DELETE FROM lagerplaetze WHERE bezeichnung LIKE ${kennung + "%"}`;
  await sql`DELETE FROM standorte WHERE name LIKE ${kennung + "%"}`;
  await sql`DELETE FROM schlagworte WHERE name LIKE ${kennung + "%"}`;
}
