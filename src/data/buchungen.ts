/**
 * Buchungen — der kritischste Codepfad des Projekts.
 *
 * Zwei Dinge passieren immer gemeinsam oder gar nicht:
 *   1. eine Zeile in der Historie
 *   2. der abgeleitete Zustand am Gerät
 *
 * Deshalb eine Transaktion, und darin `SELECT … FOR UPDATE`: Ohne die Sperre
 * könnten zwei gleichzeitige Scans desselben Geräts beide "verfuegbar" lesen
 * und beide ausgeben — das Gerät stünde dann an zwei Orten.
 */

import { db } from "../db/client.js";
import { NichtGefunden, RegelFehler } from "../api/fehler.js";
import {
  folgeStatus,
  pruefeUebergang,
  type Buchungsart,
  type Status,
} from "../domain/status.js";

export interface Buchung {
  id: string;
  geraet_id: string;
  art: Buchungsart;
  von_standort_id: string | null;
  nach_standort_id: string | null;
  nach_lagerplatz_id: string | null;
  empfaenger_id: string | null;
  empfaenger_freitext: string | null;
  erfasst_von: string;
  zeitpunkt: Date;
  geplante_rueckgabe: Date | null;
  notiz: string | null;
}

/** Eine Historienzeile mit aufgelösten Namen, wie sie angezeigt wird. */
export interface BuchungAnsicht extends Buchung {
  von_standort: string | null;
  nach_standort: string | null;
  nach_lagerplatz: string | null;
  empfaenger: string | null;
  erfasser: string;
}

export interface NeueBuchung {
  geraet_id: string;
  art: Buchungsart;
  nach_standort_id?: string | null;
  nach_lagerplatz_id?: string | null;
  empfaenger_id?: string | null;
  empfaenger_freitext?: string | null;
  geplante_rueckgabe?: string | null;
  notiz?: string | null;
  /** Nur bei Rücknahme: Ausfallschaden nimmt das Gerät aus dem Umlauf. */
  ausfall?: boolean;
}

/**
 * Bucht ein Gerät. Der Kern der Anwendung.
 */
export async function buche(daten: NeueBuchung, akteurId: string): Promise<BuchungAnsicht> {
  const id = await db().begin(async (tx) => {
    // FOR UPDATE sperrt genau diese Gerätezeile bis zum Ende der Transaktion.
    // Ein zweiter Scan wartet hier, liest danach den NEUEN Zustand und wird
    // von pruefeUebergang() korrekt abgewiesen.
    const zeilen = await tx<
      { id: string; status: Status; aktueller_standort_id: string | null }[]
    >`SELECT id, status, aktueller_standort_id FROM geraete
       WHERE id = ${daten.geraet_id} FOR UPDATE`;

    const geraet = zeilen[0];
    if (!geraet) throw new NichtGefunden("Gerät");

    pruefeUebergang(geraet.status, daten.art);

    // ── fachliche Prüfungen je Buchungsart ────────────────────────────────
    if (daten.art === "ausgabe" || daten.art === "umbuchung") {
      if (!daten.nach_standort_id) {
        throw new RegelFehler("Bitte angeben, wohin das Gerät geht.");
      }
      if (!daten.empfaenger_id && !daten.empfaenger_freitext?.trim()) {
        throw new RegelFehler("Bitte angeben, wer das Gerät übernimmt.");
      }
    }
    if (daten.art === "umbuchung" && daten.nach_standort_id === geraet.aktueller_standort_id) {
      throw new RegelFehler("Das Gerät steht bereits an diesem Standort.");
    }

    // Ziel prüfen, statt den Fremdschlüsselfehler durchschlagen zu lassen:
    // "Standort nicht gefunden" ist eine Auskunft, ein SQLSTATE nicht.
    if (daten.nach_standort_id) {
      const [ort] = await tx`SELECT id FROM standorte WHERE id = ${daten.nach_standort_id}`;
      if (!ort) throw new NichtGefunden("Standort");
    }
    if (daten.nach_lagerplatz_id) {
      const [platz] = await tx<{ standort_id: string }[]>`
        SELECT standort_id FROM lagerplaetze WHERE id = ${daten.nach_lagerplatz_id}`;
      if (!platz) throw new NichtGefunden("Lagerplatz");
      // Ein Regal gehört zu einem Ort. Beides gleichzeitig anzugeben und
      // dabei durcheinanderzubringen, wäre eine stille Falschbuchung.
      if (daten.nach_standort_id && platz.standort_id !== daten.nach_standort_id) {
        throw new RegelFehler(
          "Der gewählte Lagerplatz gehört zu einem anderen Standort.",
          "platz_falscher_standort",
        );
      }
    }

    const neuerStatus = folgeStatus(geraet.status, daten.art, daten.ausfall === true);

    // Ein zurückgenommenes Gerät hat keinen Nutzer mehr; nach einer Ausgabe
    // sehr wohl. Bei der Korrektur bleibt alles, wie der Admin es angibt.
    const behaeltNutzer = daten.art === "ausgabe" || daten.art === "umbuchung";

    const gebucht = await tx<{ id: string }[]>`
      INSERT INTO buchungen (geraet_id, art, von_standort_id, nach_standort_id,
                             nach_lagerplatz_id, empfaenger_id, empfaenger_freitext,
                             erfasst_von, geplante_rueckgabe, notiz)
      VALUES (${daten.geraet_id}, ${daten.art}, ${geraet.aktueller_standort_id},
              ${daten.nach_standort_id ?? null}, ${daten.nach_lagerplatz_id ?? null},
              ${daten.empfaenger_id ?? null},
              ${daten.empfaenger_freitext?.trim() || null},
              ${akteurId}, ${daten.geplante_rueckgabe ?? null}, ${daten.notiz ?? null})
      RETURNING id`;

    await tx`
      UPDATE geraete SET
        status                  = ${neuerStatus},
        aktueller_standort_id   = ${daten.nach_standort_id ?? geraet.aktueller_standort_id},
        aktueller_lagerplatz_id = ${daten.nach_lagerplatz_id ?? null},
        aktueller_nutzer_id     = ${behaeltNutzer ? (daten.empfaenger_id ?? null) : null},
        rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
      WHERE id = ${daten.geraet_id}`;

    return gebucht[0]!.id;
  });

  return findeBuchung(id);
}

const ANSICHT = () => db()`
  b.id, b.geraet_id, b.art, b.von_standort_id, b.nach_standort_id, b.nach_lagerplatz_id,
  b.empfaenger_id, b.empfaenger_freitext, b.erfasst_von, b.zeitpunkt,
  b.geplante_rueckgabe, b.notiz,
  vs.name AS von_standort,
  ns.name AS nach_standort,
  lp.bezeichnung AS nach_lagerplatz,
  coalesce(e.anzeigename, b.empfaenger_freitext) AS empfaenger,
  erf.anzeigename AS erfasser`;

const VERKNUEPFT = () => db()`
  FROM buchungen b
  LEFT JOIN standorte    vs ON vs.id = b.von_standort_id
  LEFT JOIN standorte    ns ON ns.id = b.nach_standort_id
  LEFT JOIN lagerplaetze lp ON lp.id = b.nach_lagerplatz_id
  LEFT JOIN benutzer      e ON e.id  = b.empfaenger_id
  JOIN      benutzer    erf ON erf.id = b.erfasst_von`;

export async function findeBuchung(id: string): Promise<BuchungAnsicht> {
  const zeilen = await db()<BuchungAnsicht[]>`
    SELECT ${ANSICHT()} ${VERKNUEPFT()} WHERE b.id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Buchung");
  return zeilen[0];
}

/** Die Historie eines Geräts, neueste zuerst. */
export async function historie(geraetId: string, grenze = 200): Promise<BuchungAnsicht[]> {
  return db()<BuchungAnsicht[]>`
    SELECT ${ANSICHT()} ${VERKNUEPFT()}
     WHERE b.geraet_id = ${geraetId}
     ORDER BY b.zeitpunkt DESC, b.id DESC
     LIMIT ${grenze}`;
}

/**
 * Alles, was gerade draußen ist — nach Dauer sortiert, das Längste zuerst.
 * Beantwortet die Frage "was hat sich irgendwo festgesetzt?".
 */
export async function offeneAusgaben(): Promise<
  {
    geraet_id: string;
    inventarnummer: string | null;
    bezeichnung: string;
    standort: string | null;
    empfaenger: string | null;
    seit: Date;
    tage: number;
    geplante_rueckgabe: Date | null;
    ueberfaellig: boolean;
  }[]
> {
  return db()`
    SELECT g.id AS geraet_id, g.inventarnummer, g.bezeichnung,
           s.name AS standort,
           coalesce(e.anzeigename, b.empfaenger_freitext) AS empfaenger,
           b.zeitpunkt AS seit,
           EXTRACT(DAY FROM NOW() - b.zeitpunkt)::int AS tage,
           b.geplante_rueckgabe,
           (b.geplante_rueckgabe IS NOT NULL AND b.geplante_rueckgabe < CURRENT_DATE) AS ueberfaellig
      FROM geraete g
      JOIN LATERAL (
        SELECT * FROM buchungen bb
         WHERE bb.geraet_id = g.id AND bb.art IN ('ausgabe', 'umbuchung')
         ORDER BY bb.zeitpunkt DESC LIMIT 1
      ) b ON TRUE
      LEFT JOIN standorte s ON s.id = g.aktueller_standort_id
      LEFT JOIN benutzer  e ON e.id = g.aktueller_nutzer_id
     WHERE g.status = 'ausgegeben'
     ORDER BY b.zeitpunkt`;
}

/**
 * Korrekturbuchung: setzt den Zustand geradeaus, ohne die Historie zu
 * verfälschen. Die falsche Buchung bleibt stehen und wird durch die
 * Korrektur ergänzt — nicht ersetzt.
 */
export async function korrigiere(
  daten: {
    geraet_id: string;
    neuer_status: Status;
    nach_standort_id?: string | null;
    empfaenger_id?: string | null;
    storniert_durch?: string | null;
    begruendung: string;
  },
  akteurId: string,
): Promise<BuchungAnsicht> {
  const begruendung = daten.begruendung.trim();
  if (!begruendung) {
    throw new RegelFehler("Eine Korrektur braucht eine Begründung — sonst ist sie nicht nachvollziehbar.");
  }

  const id = await db().begin(async (tx) => {
    const zeilen = await tx<{ status: Status; aktueller_standort_id: string | null }[]>`
      SELECT status, aktueller_standort_id FROM geraete WHERE id = ${daten.geraet_id} FOR UPDATE`;
    const geraet = zeilen[0];
    if (!geraet) throw new NichtGefunden("Gerät");

    pruefeUebergang(geraet.status, "korrektur");

    const gebucht = await tx<{ id: string }[]>`
      INSERT INTO buchungen (geraet_id, art, von_standort_id, nach_standort_id,
                             empfaenger_id, erfasst_von, notiz, storniert_durch)
      VALUES (${daten.geraet_id}, 'korrektur', ${geraet.aktueller_standort_id},
              ${daten.nach_standort_id ?? geraet.aktueller_standort_id},
              ${daten.empfaenger_id ?? null}, ${akteurId}, ${begruendung},
              ${daten.storniert_durch ?? null})
      RETURNING id`;

    await tx`
      UPDATE geraete SET
        status                = ${daten.neuer_status},
        aktueller_standort_id = ${daten.nach_standort_id ?? geraet.aktueller_standort_id},
        aktueller_nutzer_id   = ${daten.empfaenger_id ?? null},
        rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
      WHERE id = ${daten.geraet_id}`;

    return gebucht[0]!.id;
  });

  return findeBuchung(id);
}
