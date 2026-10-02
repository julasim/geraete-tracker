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

import type postgres from "postgres";
import { db } from "../db/client.js";
import { NichtGefunden, RegelFehler } from "../api/fehler.js";
import { pruefePlatzZuStandortInTx } from "./stammdaten.js";
import {
  folgeStatus,
  pruefeUebergang,
  type Buchungsart,
  type Status,
} from "../domain/status.js";

interface Buchung {
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
  const id = await db().begin(async (tx) => bucheInTx(tx, daten, akteurId));
  return findeBuchung(id);
}

/**
 * Mehrere Geräte in EINEM Vorgang buchen — das Bestücken eines Transporters.
 *
 * **Alles oder nichts.** Scheitert ein Gerät, wird die ganze Transaktion
 * zurückgerollt. Der Grund ist nicht Bequemlichkeit, sondern
 * Nachvollziehbarkeit: Eine halb ausgeführte Sammelbuchung hinterlässt einen
 * Bestand, den niemand mehr erklären kann — welche fünf der zehn Geräte sind
 * jetzt draußen? Stattdessen nennt die Fehlermeldung das Gerät beim Namen,
 * es wird aus der Liste genommen, und der Rest geht durch.
 *
 * **Die Sperren werden in fester Reihenfolge geholt** (nach Id sortiert).
 * Ohne das könnten zwei gleichzeitige Sammelbuchungen mit überlappenden
 * Geräten einander blockieren — jede hält, worauf die andere wartet. Ein
 * Deadlock, der genau dann auftritt, wenn zwei Leute morgens gleichzeitig
 * den Hänger bestücken.
 */
export async function bucheMehrere(
  geraetIds: string[],
  daten: Omit<NeueBuchung, "geraet_id">,
  akteurId: string,
): Promise<BuchungAnsicht[]> {
  const eindeutig = [...new Set(geraetIds)].sort();
  if (!eindeutig.length) throw new RegelFehler("Kein Gerät ausgewählt.");

  const ids = await db().begin(async (tx) => {
    const erzeugt: string[] = [];
    for (const geraetId of eindeutig) {
      try {
        erzeugt.push(await bucheInTx(tx, { ...daten, geraet_id: geraetId }, akteurId));
      } catch (fehler) {
        // Ohne den Namen wäre die Meldung bei zehn Geräten wertlos: "Das
        // Gerät ist defekt" — welches?
        const [g] = await tx<{ bezeichnung: string; inventarnummer: string | null }[]>`
          SELECT bezeichnung, inventarnummer FROM geraete WHERE id = ${geraetId}`;
        const name = g ? `${g.bezeichnung}${g.inventarnummer ? ` (${g.inventarnummer})` : ""}` : "Ein Gerät";
        if (fehler instanceof RegelFehler) {
          throw new RegelFehler(`${name}: ${fehler.message}`, fehler.grund);
        }
        // Ein `NichtGefunden` geht ohne Namen hinaus, und das ist richtig:
        // Ein unbekannter Lagerplatz oder Standort gilt für alle Geräte
        // gleich — ein Gerätename davor wiese in die falsche Richtung.
        throw fehler;
      }
    }
    return erzeugt;
  });

  return Promise.all(ids.map((id) => findeBuchung(id)));
}

/**
 * Der eigentliche Buchungsvorgang, innerhalb einer bereits offenen
 * Transaktion. Einzel- und Sammelbuchung teilen sich ihn, damit die
 * fachlichen Regeln an genau einer Stelle stehen.
 */
async function bucheInTx(
  tx: postgres.TransactionSql,
  daten: NeueBuchung,
  akteurId: string,
): Promise<string> {
  {
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
    /**
     * Der EFFEKTIVE Zielstandort, nicht der angegebene.
     *
     * Fehlt `nach_standort_id`, bleibt das Gerät stehen, wo es steht — dann
     * muss der Platz zu DIESEM Ort gehören. Vorher wurde die Regel in genau
     * dem Fall übersprungen: Eine Rücknahme mit `nach_lagerplatz_id` und ohne
     * `nach_standort_id` legte ein Gerät, das auf einer Baustelle steht, in
     * ein Regal im Bauhof. Ort und Platz widersprachen sich, ohne Meldung.
     *
     * Hat das Gerät gar keinen Ort (so legt der CSV-Import an), ist der
     * effektive Zielstandort `null` und die Buchung wird abgewiesen. Das ist
     * gewollt: Ein Platz ohne Ort ist kein halber Bestand, sondern ein
     * falscher.
     */
    const zielStandortId = daten.nach_standort_id ?? geraet.aktueller_standort_id;
    if (daten.nach_lagerplatz_id) {
      await pruefePlatzZuStandortInTx(tx, daten.nach_lagerplatz_id, zielStandortId);
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
        aktueller_standort_id   = ${zielStandortId},
        aktueller_lagerplatz_id = ${daten.nach_lagerplatz_id ?? null},
        aktueller_nutzer_id     = ${behaeltNutzer ? (daten.empfaenger_id ?? null) : null},
        rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
      WHERE id = ${daten.geraet_id}`;

    return gebucht[0]!.id;
  }
}

/**
 * Rücknahme und Ausfallschaden in EINER Transaktion.
 *
 * Ohne das steht das Gerät zwischen zwei HTTP-Aufrufen kurz auf `verfuegbar`
 * und könnte erneut ausgegeben werden, bevor der Schaden es sperrt.
 */
export async function bucheRuecknahmeDefekt(
  daten: Omit<NeueBuchung, "art" | "ausfall"> & { beschreibung: string },
  akteurId: string,
): Promise<{ buchungId: string; schadenId: string }> {
  return db().begin(async (tx) => {
    const buchungId = await bucheInTx(tx, { ...daten, art: "ruecknahme" }, akteurId);

    const [geraet] = await tx<{ status: string }[]>`
      SELECT status FROM geraete WHERE id = ${daten.geraet_id} FOR UPDATE`;
    if (!geraet) throw new NichtGefunden("Gerät");

    const beschreibung = daten.beschreibung.trim() || "Bei der Rücknahme als defekt gemeldet.";
    const [schaden] = await tx<{ id: string }[]>`
      INSERT INTO schaeden (geraet_id, buchung_id, gemeldet_von, beschreibung, schwere)
      VALUES (${daten.geraet_id}, ${buchungId}, ${akteurId}, ${beschreibung}, 'ausfall')
      RETURNING id`;

    await tx`UPDATE geraete SET status = 'defekt', rev = rev + 1,
                   updated_at = NOW(), updated_by = ${akteurId}
              WHERE id = ${daten.geraet_id}`;

    return { buchungId, schadenId: schaden!.id };
  });
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
    const zeilen = await tx<
      {
        status: Status;
        aktueller_standort_id: string | null;
        aktueller_lagerplatz_id: string | null;
      }[]
    >`SELECT status, aktueller_standort_id, aktueller_lagerplatz_id
        FROM geraete WHERE id = ${daten.geraet_id} FOR UPDATE`;
    const geraet = zeilen[0];
    if (!geraet) throw new NichtGefunden("Gerät");

    pruefeUebergang(geraet.status, "korrektur");

    /**
     * Wechselt der Ort, wird der Lagerplatz frei.
     *
     * Sonst bliebe ein Regal des alten Orts am Gerät stehen — genau der
     * Widerspruch, den `pruefePlatzZuStandortInTx` beim Buchen verhindert.
     * Ein neues Regal kann die Korrektur nicht setzen: `korrekturSchema`
     * kennt kein `nach_lagerplatz_id`, hier geht es allein ums Zurücksetzen.
     *
     * Die Bedingung steht bewusst in JavaScript und nicht als `CASE` im SQL:
     * Ein falsch formuliertes `CASE` löschte den Lagerplatz bei JEDER
     * Korrektur, und das fiele erst auf, wenn jemand ein Regal sucht.
     */
    const zielStandortId = daten.nach_standort_id ?? geraet.aktueller_standort_id;
    const ortWechselt = zielStandortId !== geraet.aktueller_standort_id;

    const gebucht = await tx<{ id: string }[]>`
      INSERT INTO buchungen (geraet_id, art, von_standort_id, nach_standort_id,
                             empfaenger_id, erfasst_von, notiz, storniert_durch)
      VALUES (${daten.geraet_id}, 'korrektur', ${geraet.aktueller_standort_id},
              ${zielStandortId},
              ${daten.empfaenger_id ?? null}, ${akteurId}, ${begruendung},
              ${daten.storniert_durch ?? null})
      RETURNING id`;

    await tx`
      UPDATE geraete SET
        status                  = ${daten.neuer_status},
        aktueller_standort_id   = ${zielStandortId},
        aktueller_lagerplatz_id = ${ortWechselt ? null : geraet.aktueller_lagerplatz_id},
        aktueller_nutzer_id     = ${daten.empfaenger_id ?? null},
        rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
      WHERE id = ${daten.geraet_id}`;

    return gebucht[0]!.id;
  });

  return findeBuchung(id);
}
