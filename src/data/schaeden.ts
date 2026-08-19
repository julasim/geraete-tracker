/** Schadensmeldungen. */

import { db } from "../db/client.js";
import { NichtGefunden, RegelFehler } from "../api/fehler.js";

export type Schwere = "gering" | "mittel" | "ausfall";
export type SchadenStatus = "offen" | "in_reparatur" | "erledigt";

export interface Schaden {
  id: string;
  geraet_id: string;
  buchung_id: string | null;
  gemeldet_von: string;
  gemeldet_von_name: string;
  gemeldet_am: Date;
  beschreibung: string;
  schwere: Schwere;
  status: SchadenStatus;
  erledigt_am: Date | null;
  erledigt_notiz: string | null;
  geraet?: string;
  inventarnummer?: string | null;
}

const FELDER = () => db()`
  s.id, s.geraet_id, s.buchung_id, s.gemeldet_von, s.gemeldet_am,
  s.beschreibung, s.schwere, s.status, s.erledigt_am, s.erledigt_notiz,
  b.anzeigename AS gemeldet_von_name,
  g.bezeichnung AS geraet, g.inventarnummer`;

const VERKNUEPFT = () => db()`
  FROM schaeden s
  JOIN benutzer b ON b.id = s.gemeldet_von
  JOIN geraete  g ON g.id = s.geraet_id`;

export async function listeSchaeden(nurOffene = false): Promise<Schaden[]> {
  return nurOffene
    ? db()<Schaden[]>`
        SELECT ${FELDER()} ${VERKNUEPFT()}
         WHERE s.status <> 'erledigt' ORDER BY s.gemeldet_am DESC`
    : db()<Schaden[]>`
        SELECT ${FELDER()} ${VERKNUEPFT()} ORDER BY s.gemeldet_am DESC`;
}

export async function schaedenFuerGeraet(geraetId: string): Promise<Schaden[]> {
  return db()<Schaden[]>`
    SELECT ${FELDER()} ${VERKNUEPFT()}
     WHERE s.geraet_id = ${geraetId} ORDER BY s.gemeldet_am DESC`;
}

export async function findeSchaden(id: string): Promise<Schaden> {
  const zeilen = await db()<Schaden[]>`SELECT ${FELDER()} ${VERKNUEPFT()} WHERE s.id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Schaden");
  return zeilen[0];
}

/**
 * Meldet einen Schaden. Bei Schwere "ausfall" wird das Gerät zugleich
 * gesperrt — sonst gibt es jemand am nächsten Morgen wieder aus.
 *
 * Beides in einer Transaktion: Ein gemeldeter Ausfall ohne gesperrtes Gerät
 * wäre schlimmer als gar keine Meldung, weil man sich in Sicherheit wiegt.
 */
export async function meldeSchaden(
  daten: {
    geraet_id: string;
    beschreibung: string;
    schwere: Schwere;
    buchung_id?: string | null;
  },
  akteurId: string,
): Promise<Schaden> {
  const beschreibung = daten.beschreibung.trim();
  if (beschreibung.length < 3) {
    throw new RegelFehler("Bitte kurz beschreiben, was mit dem Gerät ist.");
  }

  const id = await db().begin(async (tx) => {
    const [geraet] = await tx<{ status: string }[]>`
      SELECT status FROM geraete WHERE id = ${daten.geraet_id} FOR UPDATE`;
    if (!geraet) throw new NichtGefunden("Gerät");
    if (geraet.status === "ausgemustert") {
      throw new RegelFehler("Für ausgemusterte Geräte lassen sich keine Schäden melden.");
    }

    const zeilen = await tx<{ id: string }[]>`
      INSERT INTO schaeden (geraet_id, buchung_id, gemeldet_von, beschreibung, schwere)
      VALUES (${daten.geraet_id}, ${daten.buchung_id ?? null}, ${akteurId},
              ${beschreibung}, ${daten.schwere})
      RETURNING id`;

    if (daten.schwere === "ausfall" && geraet.status !== "ausgegeben") {
      await tx`UPDATE geraete SET status = 'defekt', rev = rev + 1,
                     updated_at = NOW(), updated_by = ${akteurId}
                WHERE id = ${daten.geraet_id}`;
    }

    return zeilen[0]!.id;
  });

  return findeSchaden(id);
}

/**
 * Schaden bearbeiten. Wird der letzte offene Schaden erledigt und war das
 * Gerät deswegen defekt, wird es wieder freigegeben — sonst müsste jemand
 * daran denken, und irgendwann denkt niemand daran.
 */
export async function aendereSchaden(
  id: string,
  daten: { status?: SchadenStatus; erledigt_notiz?: string | null },
  akteurId: string,
): Promise<Schaden> {
  const schaden = await findeSchaden(id);

  await db().begin(async (tx) => {
    const wirdErledigt = daten.status === "erledigt" && schaden.status !== "erledigt";

    await tx`
      UPDATE schaeden SET
        status = ${daten.status ?? schaden.status},
        erledigt_am = ${wirdErledigt ? new Date() : schaden.erledigt_am},
        erledigt_notiz = ${daten.erledigt_notiz ?? schaden.erledigt_notiz}
      WHERE id = ${id}`;

    if (!wirdErledigt) return;

    const [offen] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM schaeden
       WHERE geraet_id = ${schaden.geraet_id} AND status <> 'erledigt' AND id <> ${id}`;

    if ((offen?.n ?? 0) === 0) {
      await tx`
        UPDATE geraete SET status = 'verfuegbar', rev = rev + 1,
               updated_at = NOW(), updated_by = ${akteurId}
         WHERE id = ${schaden.geraet_id} AND status = 'defekt'`;
    }
  });

  return findeSchaden(id);
}
