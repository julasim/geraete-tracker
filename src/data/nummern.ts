/**
 * Das Register der Etikettennummern.
 *
 * Eine Nummer ist verbraucht, sobald sie dem System einmal begegnet ist —
 * ob als Gerät, als Vorratsdruck oder als gescanntes Altetikett. Sie wird
 * danach nie ein zweites Mal ausgegeben.
 *
 * Warum ein eigenes Register und nicht einfach die Gerätetabelle:
 * Während der Ersterfassung kleben draußen Etiketten, die im System noch
 * niemand kennt. Wer die nächste Nummer aus dem Höchstwert der ERFASSTEN
 * Geräte ableitet, trifft früher oder später eine davon — und dann klebt
 * dieselbe Nummer zweimal. Ein doppeltes Etikett fällt niemandem auf,
 * bis ein Scan das falsche Gerät zeigt.
 */

import type postgres from "postgres";
import { db } from "../db/client.js";
import { alsNummer } from "../domain/barcode.js";

/** Dieselbe Sperre wie bei der Geräteanlage — die Vergabe ist EIN Nadelöhr. */
export const SPERRE_NUMMERNKREIS = 7_319_777;

export type NummernZustand = "vergeben" | "reserviert" | "gesehen";

export interface Etikettennummer {
  nummer: string;
  zustand: NummernZustand;
  geraet_id: string | null;
  notiz: string | null;
  erfasst_am: string;
}

/**
 * Die nächste freie Nummer — gemessen am REGISTER, nicht an den Geräten.
 *
 * Muss innerhalb einer Transaktion laufen, die die Sperre hält, sonst
 * bekommen zwei gleichzeitige Anlagen dieselbe Nummer.
 */
export async function naechsteFreieNummerInTx(tx: postgres.TransactionSql): Promise<string> {
  await tx`SELECT pg_advisory_xact_lock(${SPERRE_NUMMERNKREIS})`;
  const [nummer] = await naechsteFreie(tx, 1);
  return nummer!;
}

/**
 * Die nächsten `anzahl` freien Nummern.
 *
 * Zwei getrennte Fragen, und genau darin lag ein Fehler, der beim Testen
 * auffiel:
 *
 * 1. **Wo steht die Reihe?** Das sagen nur Nummern, die kontrolliert
 *    ausgegeben wurden — `vergeben` und `reserviert`. Ein beim Scannen
 *    aufgetauchtes Etikett zählt hier NICHT: Wer sich bei der Handeingabe
 *    einmal auf 99999 vertippt, dürfte nicht dafür sorgen, dass ab sofort
 *    jede Nummer sechsstellig ist. Genau das ist im Testlauf passiert —
 *    der Nummernkreis sprang von 11020 auf 100029.
 * 2. **Ist diese eine Nummer frei?** Dafür zählt JEDER Eintrag, auch
 *    `gesehen`. Klebt 10114 draußen und wurde einmal gescannt, wird sie
 *    übersprungen — sonst klebte sie zweimal.
 *
 * Muss in einer Transaktion laufen, die die Sperre hält.
 */
async function naechsteFreie(tx: postgres.TransactionSql, anzahl: number): Promise<string[]> {
  const [grenze] = await tx<{ hoechste: string | null }[]>`
    SELECT max((nummer)::text::bigint)::text AS hoechste
      FROM etikettennummern
     WHERE zaehlt_fuer_vergabe
       AND zustand IN ('vergeben', 'reserviert')
       AND (nummer)::text ~ '^[0-9]+$'`;

  const start = Number(grenze?.hoechste ?? 10_000);

  // Alles, was oberhalb der Reihe schon belegt ist — gesehene Altetiketten,
  // Vorratsnummern, Ersatzetiketten. Das sind wenige Zeilen.
  const belegteZeilen = await tx<{ n: string }[]>`
    SELECT (nummer)::text AS n
      FROM etikettennummern
     WHERE (nummer)::text ~ '^[0-9]+$'
       AND (nummer)::text::bigint > ${start}`;
  const belegt = new Set(belegteZeilen.map((z) => Number(z.n)));

  const stellen = grenze?.hoechste?.length ?? 5;
  const neu: string[] = [];
  let kandidat = start;
  while (neu.length < anzahl) {
    kandidat++;
    if (belegt.has(kandidat)) continue;
    neu.push(alsNummer(kandidat, stellen));
  }
  return neu;
}

/**
 * Trägt eine Nummer als vergeben ein und hängt sie an ihr Gerät.
 *
 * Läuft mit ON CONFLICT: Eine zuvor reservierte oder gesehene Nummer wird
 * dabei zur vergebenen — genau das ist der Weg vom Vorratsetikett zum
 * erfassten Gerät. Eine Nummer, die schon einem ANDEREN Gerät gehört,
 * wird vorher abgefangen (siehe legeGeraetAn).
 */
export async function vergibNummerInTx(
  tx: postgres.TransactionSql,
  nummer: string,
  geraetId: string,
  akteurId?: string | null,
  /**
   * Ist das die Inventarnummer des Geräts (true) oder ein zusätzliches
   * Etikett (false)? Ein Ersatzetikett aus einem fremden Nummernbereich
   * darf den laufenden Kreis nicht mit nach oben ziehen.
   */
  zaehltFuerVergabe = true,
): Promise<void> {
  await tx`
    INSERT INTO etikettennummern (nummer, zustand, geraet_id, zaehlt_fuer_vergabe, erfasst_von)
    VALUES (${nummer}, 'vergeben', ${geraetId}, ${zaehltFuerVergabe}, ${akteurId ?? null})
    ON CONFLICT (nummer) DO UPDATE
       SET zustand = 'vergeben',
           geraet_id = EXCLUDED.geraet_id`;
}

/**
 * Reserviert eine Anzahl neuer Nummern in einem Zug — für den Vorratsdruck.
 *
 * Alles in EINER Transaktion mit Sperre: Zwei Leute, die gleichzeitig einen
 * Bogen drucken, bekommen garantiert verschiedene Nummern. Die Nummern sind
 * sofort belegt, auch wenn der Ausdruck nachher im Papierkorb landet — eine
 * verlorene Nummer kostet nichts, eine doppelte kostet Vertrauen.
 */
export async function reserviereNummern(
  anzahl: number,
  akteurId: string | null,
  notiz = "auf Vorrat gedruckt",
): Promise<string[]> {
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${SPERRE_NUMMERNKREIS})`;
    const neu = await naechsteFreie(tx, anzahl);

    /**
     * EIN Insert für alle Nummern, nicht 500 einzelne.
     *
     * Nicht nur wegen der Geschwindigkeit: Die Nummernsperre wird so lange
     * gehalten, wie diese Transaktion läuft — und jede Geräteanlage im Haus
     * wartet darauf. Bei 500 einzelnen Anweisungen stand alles andere
     * sekundenlang. Beim Testlauf sind daraus prompt Zeitüberschreitungen
     * in anderen Testdateien geworden.
     */
    await tx`
      INSERT INTO etikettennummern ${tx(
        neu.map((nummer) => ({
          nummer,
          zustand: "reserviert",
          notiz,
          erfasst_von: akteurId,
        })),
      )}`;
    return neu;
  });
}

/**
 * Hält fest, dass eine Nummer draußen existiert, obwohl sie das System
 * nicht kennt — der Altbestand, der beim Scannen auftaucht.
 *
 * Das ist die einzige Möglichkeit, geklebte Etiketten zu erfahren, die nie
 * erfasst wurden. Ab dem ersten Scan ist die Nummer verbraucht und wird
 * nicht mehr an ein anderes Gerät vergeben.
 *
 * Schreibt still und idempotent: Der Scan ist ein Lesevorgang, und ein
 * Fehler beim Mitschreiben darf ihn nicht scheitern lassen.
 */
export async function merkeGesehen(nummer: string, akteurId?: string | null): Promise<void> {
  await db()`
    INSERT INTO etikettennummern (nummer, zustand, zaehlt_fuer_vergabe, notiz, erfasst_von)
    VALUES (${nummer}, 'gesehen', FALSE,
            'beim Scannen aufgetaucht, kein Gerät dazu', ${akteurId ?? null})
    ON CONFLICT (nummer) DO NOTHING`;
}

/** Alle reservierten Nummern, die noch auf ihr Gerät warten. */
export async function offeneReservierungen(): Promise<Etikettennummer[]> {
  return db()<Etikettennummer[]>`
    SELECT nummer, zustand, geraet_id, notiz, erfasst_am
      FROM etikettennummern
     WHERE zustand = 'reserviert'
     ORDER BY (nummer)::text`;
}

/** Wie viele Nummern in welchem Zustand — für die Übersicht beim Drucken. */
export async function nummernUebersicht(): Promise<{
  vergeben: number;
  reserviert: number;
  gesehen: number;
  hoechste: string | null;
}> {
  const [z] = await db()<{ vergeben: number; reserviert: number; gesehen: number }[]>`
    SELECT count(*) FILTER (WHERE zustand = 'vergeben')::int   AS vergeben,
           count(*) FILTER (WHERE zustand = 'reserviert')::int AS reserviert,
           count(*) FILTER (WHERE zustand = 'gesehen')::int    AS gesehen
      FROM etikettennummern`;
  const [h] = await db()<{ nummer: string }[]>`
    SELECT nummer FROM etikettennummern
     WHERE (nummer)::text ~ '^[0-9]+$' AND zaehlt_fuer_vergabe
       AND zustand IN ('vergeben', 'reserviert')
     ORDER BY (nummer)::text::bigint DESC LIMIT 1`;
  return {
    vergeben: z?.vergeben ?? 0,
    reserviert: z?.reserviert ?? 0,
    gesehen: z?.gesehen ?? 0,
    hoechste: h?.nummer ?? null,
  };
}

/**
 * Einen ganzen Bereich als belegt eintragen — für den Fall, dass jemand
 * weiß, bis wohin die alten Etiketten reichen.
 *
 * Bewusst kein Pflichtschritt: Julius weiß es nicht genau, und die
 * Anwendung soll auch ohne diese Angabe sicher sein. Wer es später
 * herausfindet, trägt es nach.
 */
export async function merkeBereich(
  von: string,
  bis: string,
  akteurId: string | null,
): Promise<{ eingetragen: number; uebersprungen: number }> {
  const start = Number(von);
  const ende = Number(bis);
  if (!Number.isFinite(start) || !Number.isFinite(ende) || start > ende) {
    throw new Error("Der Bereich ist nicht lesbar.");
  }
  const stellen = von.length;

  const alle: {
    nummer: string;
    zustand: string;
    zaehlt_fuer_vergabe: boolean;
    notiz: string;
    erfasst_von: string | null;
  }[] = [];
  for (let n = start; n <= ende; n++) {
    alle.push({
      nummer: String(n).padStart(stellen, "0"),
      zustand: "gesehen",
      // Blockiert die einzelne Nummer, verschiebt aber nicht die Reihe.
      zaehlt_fuer_vergabe: false,
      notiz: "Altbestand, als Bereich eingetragen",
      erfasst_von: akteurId,
    });
  }

  // Ebenfalls in einem Zug — siehe reserviereNummern: Die Sperre blockiert
  // währenddessen jede andere Nummernvergabe.
  const geschrieben = await db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${SPERRE_NUMMERNKREIS})`;
    return tx`
      INSERT INTO etikettennummern ${tx(alle)}
      ON CONFLICT (nummer) DO NOTHING
      RETURNING nummer`;
  });

  return {
    eingetragen: geschrieben.length,
    uebersprungen: alle.length - geschrieben.length,
  };
}
