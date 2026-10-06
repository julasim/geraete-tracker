/**
 * Logbuch — lückenloser Nachweis aller schreibenden Vorgänge.
 *
 * `protokolliere()` ist bewusst fehlertolerant: Ein gescheiterter
 * Logbuch-Eintrag darf die eigentliche Aktion nicht zurückrollen. Deshalb
 * kein gemeinsamer Transaktionskontext mit der Fachaktion — der Eintrag
 * entsteht NACH dem erfolgreichen Abschluss. Der Preis ist, dass eine
 * Aktion theoretisch ohne Protokolleintrag bleiben kann (Absturz genau
 * dazwischen); die Alternative — Fachaktion und Protokoll in einer
 * Transaktion — würde bedeuten, dass ein voller Logbuch-Index die
 * Geräteverwaltung lahmlegt.
 */

import { db } from "../db/client.js";
import { logError } from "../logger.js";

export interface LogbuchEintrag {
  benutzer_id: string;
  aktion: string;
  bereich: string;
  ziel_id?: string | null;
  ziel_text?: string | null;
  details?: Record<string, unknown> | null;
}

export async function protokolliere(eintrag: LogbuchEintrag): Promise<void> {
  try {
    await db()`
      INSERT INTO logbuch (benutzer_id, aktion, bereich, ziel_id, ziel_text, details)
      VALUES (
        ${eintrag.benutzer_id},
        ${eintrag.aktion},
        ${eintrag.bereich},
        ${eintrag.ziel_id ?? null},
        ${eintrag.ziel_text ?? null},
        ${eintrag.details ? JSON.stringify(eintrag.details) : null}
      )`;
  } catch (fehler) {
    logError("Logbuch-Eintrag fehlgeschlagen", { eintrag, fehler });
  }
}

export interface LogbuchFilter {
  bereich?: string;
  benutzer_id?: string;
  limit?: number;
  offset?: number;
}

export interface LogbuchZeile {
  id: string;
  zeitpunkt: string;
  benutzer_id: string;
  anzeigename: string;
  aktion: string;
  bereich: string;
  ziel_id: string | null;
  ziel_text: string | null;
  details: Record<string, unknown> | null;
}

export async function leseLogbuch(
  filter: LogbuchFilter = {},
): Promise<{ eintraege: LogbuchZeile[]; gesamt: number }> {
  const sql = db();
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;

  const bedingungen: string[] = [];
  const werte: (string | number)[] = [];

  if (filter.bereich) {
    bedingungen.push(`l.bereich = $${werte.length + 1}`);
    werte.push(filter.bereich);
  }
  if (filter.benutzer_id) {
    bedingungen.push(`l.benutzer_id = $${werte.length + 1}::uuid`);
    werte.push(filter.benutzer_id);
  }

  const wo = bedingungen.length ? `WHERE ${bedingungen.join(" AND ")}` : "";

  const [zeilen, zaehlung] = await Promise.all([
    sql.unsafe<LogbuchZeile[]>(
      `SELECT l.id, l.zeitpunkt, l.benutzer_id, b.anzeigename,
              l.aktion, l.bereich, l.ziel_id, l.ziel_text, l.details
       FROM logbuch l
       JOIN benutzer b ON b.id = l.benutzer_id
       ${wo}
       ORDER BY l.zeitpunkt DESC
       LIMIT ${limit} OFFSET ${offset}`,
      werte,
    ),
    sql.unsafe<[{ anzahl: string }]>(
      `SELECT COUNT(*)::text AS anzahl FROM logbuch l ${wo}`,
      werte,
    ),
  ]);

  return {
    eintraege: zeilen,
    gesamt: Number(zaehlung[0]?.anzahl ?? 0),
  };
}

/** Alle Bereiche, die im Logbuch vorkommen — für die Filterauswahl. */
export async function logbuchBereiche(): Promise<string[]> {
  const zeilen = await db()<{ bereich: string }[]>`
    SELECT DISTINCT bereich FROM logbuch ORDER BY bereich`;
  return zeilen.map((z) => z.bereich);
}
