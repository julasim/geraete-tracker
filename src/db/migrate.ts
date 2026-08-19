/**
 * Migrationslauf: wendet alle noch nicht angewandten SQL-Dateien aus
 * migrations/ an, in alphabetischer Reihenfolge.
 *
 * Grundsätze:
 *   * nur vorwärts, kein Zurück. Ein Fehler wird durch eine neue Migration
 *     behoben, nicht durch das Rückgängigmachen einer alten.
 *   * jede Datei in einer eigenen Transaktion — bricht eine ab, ist sie
 *     vollständig zurückgerollt und die vorherigen bleiben angewandt.
 *   * eine Sperre über den gesamten Lauf. Starten zwei App-Container
 *     gleichzeitig, wartet der zweite, statt dieselbe Migration doppelt
 *     anzuwenden.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./client.js";
import { logInfo, logWarn } from "../logger.js";

const HIER = dirname(fileURLToPath(import.meta.url));
const ORDNER = join(HIER, "migrations");

// Beliebige, aber feste Zahl. Alle Prozesse dieser App nehmen dieselbe.
const SPERRE = 7_319_501;

export interface MigrationsStand {
  name: string;
  angewandt: boolean;
  zeitpunkt?: Date;
}

async function legeTabelleAn(): Promise<void> {
  await db()`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      name       TEXT UNIQUE NOT NULL,
      angewandt_am TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
}

async function dateienLesen(): Promise<string[]> {
  const alle = await readdir(ORDNER);
  return alle.filter((n) => n.endsWith(".sql")).sort();
}

/** Welche Migrationen gibt es, welche sind bereits angewandt? */
export async function migrationsStand(): Promise<MigrationsStand[]> {
  await legeTabelleAn();
  const dateien = await dateienLesen();
  const zeilen = await db()<{ name: string; angewandt_am: Date }[]>`
    SELECT name, angewandt_am FROM _migrations`;
  const bekannt = new Map(zeilen.map((z) => [z.name, z.angewandt_am]));

  const stand = dateien.map((name) => ({
    name,
    angewandt: bekannt.has(name),
    ...(bekannt.has(name) ? { zeitpunkt: bekannt.get(name)! } : {}),
  }));

  // Eingetragen, aber Datei weg: deutet auf ein unvollständiges Deployment
  // oder eine gelöschte Migration hin. Kein Abbruch, aber sichtbar machen.
  for (const name of bekannt.keys()) {
    if (!dateien.includes(name)) {
      logWarn("Migration in der Datenbank vermerkt, Datei fehlt", { name });
    }
  }
  return stand;
}

/** Wendet alle offenen Migrationen an. Gibt die Namen der angewandten zurück. */
export async function migriere(): Promise<string[]> {
  const sql = db();
  await legeTabelleAn();

  // Sperre über den ganzen Lauf; wird beim Verbindungsende automatisch frei.
  await sql`SELECT pg_advisory_lock(${SPERRE})`;
  const angewandt: string[] = [];

  try {
    const dateien = await dateienLesen();
    const zeilen = await sql<{ name: string }[]>`SELECT name FROM _migrations`;
    const schonDa = new Set(zeilen.map((z) => z.name));

    for (const name of dateien) {
      if (schonDa.has(name)) continue;
      const inhalt = await readFile(join(ORDNER, name), "utf8");
      const start = Date.now();

      await sql.begin(async (tx) => {
        await tx.unsafe(inhalt); // die Datei selbst, keine Nutzereingabe
        await tx`INSERT INTO _migrations (name) VALUES (${name})`;
      });

      angewandt.push(name);
      logInfo("Migration angewandt", { name, dauerMs: Date.now() - start });
    }

    if (angewandt.length === 0) logInfo("Datenbank ist auf aktuellem Stand");
    return angewandt;
  } finally {
    await sql`SELECT pg_advisory_unlock(${SPERRE})`;
  }
}
