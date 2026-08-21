/**
 * Geräte: Stammdaten, Etiketten, Schlagworte.
 *
 * Der Zustand eines Geräts (status, Standort, Lagerplatz, Nutzer) wird hier
 * nur GELESEN. Geändert wird er ausschließlich über eine Buchung (AP5) —
 * sonst liefen Bestand und Historie auseinander, und die Historie wäre nicht
 * mehr die Wahrheit, sondern eine Erzählung.
 */

import type postgres from "postgres";
import { db } from "../db/client.js";
import { KonfliktFehler, NichtGefunden, RegelFehler } from "../api/fehler.js";
import { codeArt, normalisiere, suchVarianten } from "../domain/barcode.js";
import { naechsteFreieNummerInTx, vergibNummerInTx } from "./nummern.js";

export type GeraetStatus =
  | "verfuegbar"
  | "ausgegeben"
  | "wartung"
  | "defekt"
  | "ausgemustert";

export interface Geraet {
  id: string;
  inventarnummer: string | null;
  bezeichnung: string;
  hersteller: string | null;
  modell: string | null;
  seriennummer: string | null;
  anschaffungsdatum: Date | null;
  anschaffungswert: string | null;
  status: GeraetStatus;
  aktueller_standort_id: string | null;
  aktueller_lagerplatz_id: string | null;
  aktueller_nutzer_id: string | null;
  foto_pfad: string | null;
  notiz: string | null;
  betriebsstunden: string | null;
  gehoert_zu_id: string | null;
  rev: number;
}

/** Was die Liste und die Gerätekarte anzeigen — mit aufgelösten Namen. */
export interface GeraetAnsicht extends Geraet {
  standort: string | null;
  lagerplatz: string | null;
  nutzer: string | null;
  schlagworte: { id: string; name: string; farbe: string | null }[];
  offene_schaeden: number;
  titelbild_id: string | null;
  gehoert_zu: string | null;
  zubehoer: { id: string; bezeichnung: string; inventarnummer: string | null; status: string }[];
}

const ANSICHT = () => db()`
  g.id, g.inventarnummer, g.bezeichnung, g.hersteller, g.modell, g.seriennummer,
  g.anschaffungsdatum, g.anschaffungswert, g.status,
  g.aktueller_standort_id, g.aktueller_lagerplatz_id, g.aktueller_nutzer_id,
  g.foto_pfad, g.notiz, g.betriebsstunden, g.gehoert_zu_id, g.rev,
  s.name AS standort,
  p.bezeichnung AS lagerplatz,
  b.anzeigename AS nutzer,
  coalesce((
    SELECT json_agg(json_build_object('id', w.id, 'name', w.name, 'farbe', w.farbe)
                    ORDER BY w.sort_order, w.name)
      FROM geraet_schlagworte gs JOIN schlagworte w ON w.id = gs.schlagwort_id
     WHERE gs.geraet_id = g.id
  ), '[]'::json) AS schlagworte,
  (SELECT count(*)::int FROM schaeden sc
    WHERE sc.geraet_id = g.id AND sc.status <> 'erledigt') AS offene_schaeden,
  (SELECT d.id FROM dateien d
    WHERE d.geraet_id = g.id AND d.ist_titelbild LIMIT 1) AS titelbild_id,
  eltern.bezeichnung AS gehoert_zu,
  coalesce((
    SELECT json_agg(json_build_object('id', z.id, 'bezeichnung', z.bezeichnung,
                                      'inventarnummer', z.inventarnummer, 'status', z.status)
                    ORDER BY z.bezeichnung)
      FROM geraete z WHERE z.gehoert_zu_id = g.id AND z.status <> 'ausgemustert'
  ), '[]'::json) AS zubehoer`;

const VERKNUEPFT = () => db()`
  FROM geraete g
  LEFT JOIN standorte   s ON s.id = g.aktueller_standort_id
  LEFT JOIN lagerplaetze p ON p.id = g.aktueller_lagerplatz_id
  LEFT JOIN benutzer    b ON b.id = g.aktueller_nutzer_id
  LEFT JOIN geraete eltern ON eltern.id = g.gehoert_zu_id`;

/**
 * Die ganze Liste auf einmal.
 *
 * Bewusst ohne Paginierung: Bei rund 200 Geräten ist das ein Bruchteil
 * einer Sekunde, und das Frontend kann ohne weiteren Serveraufruf filtern
 * und suchen — auf der Baustelle jede Zehntelsekunde wert.
 */
export async function listeGeraete(): Promise<GeraetAnsicht[]> {
  return db()<GeraetAnsicht[]>`
    SELECT ${ANSICHT()} ${VERKNUEPFT()}
     WHERE g.status <> 'ausgemustert'
     ORDER BY g.bezeichnung, g.inventarnummer`;
}

export async function listeAlleGeraete(): Promise<GeraetAnsicht[]> {
  return db()<GeraetAnsicht[]>`
    SELECT ${ANSICHT()} ${VERKNUEPFT()} ORDER BY g.bezeichnung, g.inventarnummer`;
}

export async function findeGeraet(id: string): Promise<GeraetAnsicht> {
  const zeilen = await db()<GeraetAnsicht[]>`
    SELECT ${ANSICHT()} ${VERKNUEPFT()} WHERE g.id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Gerät");
  return zeilen[0];
}

/**
 * Sucht ein Gerät über einen gescannten oder getippten Code.
 *
 * Gesucht wird über alle Etiketten des Geräts UND über die Inventarnummer,
 * jeweils in allen Schreibweisen aus suchVarianten(). Finden sich dabei
 * MEHRERE verschiedene Geräte, wird keines zurückgegeben — dann muss der
 * Benutzer entscheiden, statt dass die App still das falsche bucht.
 */
export async function findeGeraetNachCode(
  code: string,
): Promise<{ geraet: GeraetAnsicht | null; mehrdeutig: GeraetAnsicht[] }> {
  const varianten = suchVarianten(code);
  if (!varianten.length) return { geraet: null, mehrdeutig: [] };

  // Kein DISTINCT: Die Unterabfrage liefert bereits eindeutige Geräte-IDs.
  // Es wäre nicht nur überflüssig, sondern ein Fehler — die Schlagwort-Spalte
  // ist vom Typ json, und json kennt in Postgres keinen Gleichheitsoperator.
  const treffer = await db()<GeraetAnsicht[]>`
    SELECT ${ANSICHT()} ${VERKNUEPFT()}
     WHERE g.id IN (
       SELECT geraet_id FROM geraete_barcodes
        WHERE barcode = ANY(${varianten}) AND aktiv
       UNION
       SELECT id FROM geraete WHERE inventarnummer = ANY(${varianten})
     )`;

  if (treffer.length === 1) return { geraet: treffer[0]!, mehrdeutig: [] };
  if (treffer.length > 1) return { geraet: null, mehrdeutig: treffer };
  return { geraet: null, mehrdeutig: [] };
}

/** Freitextsuche über Bezeichnung, Hersteller, Modell, Serien- und Inventarnummer. */
export async function sucheGeraete(text: string): Promise<GeraetAnsicht[]> {
  const muster = `%${text.trim()}%`;
  return db()<GeraetAnsicht[]>`
    SELECT ${ANSICHT()} ${VERKNUEPFT()}
     WHERE g.status <> 'ausgemustert'
       AND (g.bezeichnung ILIKE ${muster}
         OR g.hersteller ILIKE ${muster}
         OR g.modell ILIKE ${muster}
         OR g.seriennummer ILIKE ${muster}
         OR g.inventarnummer ILIKE ${muster})
     ORDER BY g.bezeichnung
     LIMIT 100`;
}

export interface NeuesGeraet {
  bezeichnung: string;
  inventarnummer?: string | null;
  barcode?: string | null;
  hersteller?: string | null;
  modell?: string | null;
  seriennummer?: string | null;
  anschaffungsdatum?: string | null;
  anschaffungswert?: number | null;
  notiz?: string | null;
  betriebsstunden?: number | null;
  standort_id?: string | null;
  schlagworte?: string[];
}

/**
 * Legt ein Gerät an, vergibt das Etikett und setzt den Anfangsstandort.
 *
 * Alles in einer Transaktion: ein Gerät ohne Etikett wäre nicht auffindbar,
 * ein Etikett ohne Gerät ein Geist.
 */
export async function legeGeraetAn(daten: NeuesGeraet, akteurId: string): Promise<GeraetAnsicht> {
  const bezeichnung = daten.bezeichnung.trim();
  if (!bezeichnung) throw new RegelFehler("Das Gerät braucht eine Bezeichnung.");

  // Was ohne Datenbank prüfbar ist, wird vor der Transaktion geprüft — das
  // hält die Sperre unten so kurz wie möglich.
  const vorgegebeneNummer = daten.inventarnummer?.trim()
    ? normalisiere(daten.inventarnummer)
    : null;
  if (vorgegebeneNummer && codeArt(vorgegebeneNummer) !== "geraet") {
    throw new RegelFehler(
      `"${vorgegebeneNummer}" ist keine gültige Gerätenummer. Erlaubt sind Ziffern; ` +
        `Codes mit "P-" gehören zu Lagerplätzen.`,
    );
  }

  const vorgegebenerBarcode = daten.barcode?.trim() ? normalisiere(daten.barcode) : null;
  if (vorgegebenerBarcode && codeArt(vorgegebenerBarcode) !== "geraet") {
    throw new RegelFehler(`"${vorgegebenerBarcode}" ist kein gültiger Geräte-Barcode.`);
  }

  /**
   * Ab hier ALLES in einer Transaktion: Nummer ermitteln, Eindeutigkeit
   * prüfen, schreiben. Läge auch nur die Prüfung davor, könnte zwischen
   * "ist frei" und "wird geschrieben" jemand dazwischenkommen.
   */
  const id = await db().begin(async (tx) => {
    const nummer = vorgegebeneNummer ?? (await naechsteFreieNummerInTx(tx));
    const barcode = vorgegebenerBarcode ?? nummer;

    const [nummerVergeben] = await tx`
      SELECT id FROM geraete WHERE inventarnummer = ${nummer}`;
    if (nummerVergeben) throw new RegelFehler(`Die Nummer ${nummer} ist bereits vergeben.`);

    const [codeVergeben] = await tx`
      SELECT geraet_id FROM geraete_barcodes WHERE barcode = ${barcode}`;
    if (codeVergeben) throw new RegelFehler(`Das Etikett ${barcode} gehört bereits zu einem Gerät.`);

    /**
     * Und gegen das Register: Eine Nummer kann belegt sein, ohne dass ein
     * Gerät sie trägt.
     *
     * "reserviert" (auf Vorrat gedruckt) und "gesehen" (beim Scannen
     * aufgetaucht) sind hier ausdrücklich KEIN Hindernis — im Gegenteil,
     * das ist der Normalfall: Etikett kleben, scannen, "noch nicht erfasst",
     * Gerät anlegen. Die Nummer holt jetzt ihr Gerät ab. Nur eine Nummer,
     * die bereits an einem Gerät hängt, wird abgewiesen.
     *
     * Was das Register verhindert, ist etwas anderes: dass die AUTOMATISCHE
     * Vergabe eine solche Nummer ein zweites Mal ausgibt.
     */
    for (const kandidat of new Set([nummer, barcode])) {
      const [bekannt] = await tx<{ zustand: string; geraet_id: string | null }[]>`
        SELECT zustand, geraet_id FROM etikettennummern WHERE nummer = ${kandidat}`;
      if (bekannt?.zustand === "vergeben" && bekannt.geraet_id) {
        throw new RegelFehler(`Die Nummer ${kandidat} gehört bereits zu einem Gerät.`);
      }
    }

    const zeilen = await tx<{ id: string }[]>`
      INSERT INTO geraete (inventarnummer, bezeichnung, hersteller, modell, seriennummer,
                           anschaffungsdatum, anschaffungswert, notiz, betriebsstunden,
                           aktueller_standort_id, created_by, updated_by)
      VALUES (${nummer}, ${bezeichnung}, ${daten.hersteller ?? null}, ${daten.modell ?? null},
              ${daten.seriennummer ?? null}, ${daten.anschaffungsdatum ?? null},
              ${daten.anschaffungswert ?? null}, ${daten.notiz ?? null},
              ${daten.betriebsstunden ?? null},
              ${daten.standort_id ?? null}, ${akteurId}, ${akteurId})
      RETURNING id`;
    const neueId = zeilen[0]!.id;

    await tx`INSERT INTO geraete_barcodes (barcode, geraet_id, erfasst_von)
             VALUES (${barcode}, ${neueId}, ${akteurId})`;

    // Beide ins Register — die Nummer gilt ab jetzt als verbraucht, auch
    // wenn das Gerät später gelöscht wird.
    await vergibNummerInTx(tx, nummer, neueId, akteurId);
    if (barcode !== nummer) {
      // Zusatzetikett: gilt als verbraucht, zählt aber nicht für die Vergabe.
      await vergibNummerInTx(tx, barcode, neueId, akteurId, false);
    }

    if (daten.schlagworte?.length) {
      await tx`INSERT INTO geraet_schlagworte ${tx(
        daten.schlagworte.map((wid) => ({ geraet_id: neueId, schlagwort_id: wid })),
      )}`;
    }
    return neueId;
  });

  return findeGeraet(id);
}

/**
 * Die Nummernvergabe liegt seit dem Etikettenregister in `data/nummern.ts`.
 *
 * Der Grund für den Umzug: Sie fragte den Höchstwert der ERFASSTEN Geräte ab.
 * Während der Ersterfassung kleben draußen aber Etiketten, die das System
 * noch nicht kennt — und irgendwann trifft die Vergabe eine davon. Dann
 * klebt dieselbe Nummer zweimal, und ein Scan zeigt das falsche Gerät.
 * Das Register kennt zusätzlich reservierte und beim Scannen aufgetauchte
 * Nummern.
 */

export interface GeraetAenderung {
  bezeichnung?: string;
  hersteller?: string | null;
  modell?: string | null;
  seriennummer?: string | null;
  anschaffungsdatum?: string | null;
  anschaffungswert?: number | null;
  notiz?: string | null;
  schlagworte?: string[];
  betriebsstunden?: number | null;
  gehoert_zu_id?: string | null;
  rev: number;
}

/**
 * Ändert Stammdaten — NICHT den Zustand. Standort, Lagerplatz und Nutzer
 * ändern sich ausschließlich über eine Buchung.
 *
 * Der Konfliktschutz über `rev` verhindert, dass zwei Leute gleichzeitig
 * dasselbe Gerät bearbeiten und einer die Änderung des anderen still
 * überschreibt.
 */
export async function aendereGeraet(
  id: string,
  daten: GeraetAenderung,
  akteurId: string,
): Promise<GeraetAnsicht> {
  const alt = await findeGeraet(id);

  if (alt.rev !== daten.rev) {
    throw new KonfliktFehler(
      "Jemand anderes hat dieses Gerät inzwischen bearbeitet.",
      daten.rev,
      alt.rev,
      alt,
    );
  }
  if (alt.status === "ausgemustert") {
    throw new RegelFehler("Ausgemusterte Geräte lassen sich nicht mehr bearbeiten.");
  }

  await db().begin(async (tx) => {
    // Die WHERE-Bedingung auf rev ist die eigentliche Absicherung: zwischen
    // dem Lesen oben und diesem UPDATE könnte jemand dazwischengekommen sein.
    const zeilen = await tx<{ id: string }[]>`
      UPDATE geraete SET
        bezeichnung       = ${daten.bezeichnung?.trim() || alt.bezeichnung},
        hersteller        = ${daten.hersteller === undefined ? alt.hersteller : daten.hersteller},
        modell            = ${daten.modell === undefined ? alt.modell : daten.modell},
        seriennummer      = ${daten.seriennummer === undefined ? alt.seriennummer : daten.seriennummer},
        anschaffungsdatum = ${daten.anschaffungsdatum === undefined ? alt.anschaffungsdatum : daten.anschaffungsdatum},
        anschaffungswert  = ${daten.anschaffungswert === undefined ? alt.anschaffungswert : daten.anschaffungswert},
        notiz             = ${daten.notiz === undefined ? alt.notiz : daten.notiz},
        betriebsstunden   = ${daten.betriebsstunden === undefined ? alt.betriebsstunden : daten.betriebsstunden},
        gehoert_zu_id     = ${daten.gehoert_zu_id === undefined ? alt.gehoert_zu_id : daten.gehoert_zu_id},
        rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
      WHERE id = ${id} AND rev = ${daten.rev}
      RETURNING id`;

    if (!zeilen.length) {
      throw new KonfliktFehler(
        "Jemand anderes hat dieses Gerät inzwischen bearbeitet.",
        daten.rev,
        alt.rev + 1,
      );
    }

    if (daten.schlagworte) {
      await tx`DELETE FROM geraet_schlagworte WHERE geraet_id = ${id}`;
      if (daten.schlagworte.length) {
        await tx`INSERT INTO geraet_schlagworte ${tx(
          daten.schlagworte.map((wid) => ({ geraet_id: id, schlagwort_id: wid })),
        )}`;
      }
    }
  });

  return findeGeraet(id);
}

/**
 * Ausmustern statt löschen. Ein Gerät mit Historie darf nicht verschwinden —
 * sonst zeigte die Historie auf ein Nichts. Die Datenbank verhindert das
 * Löschen ohnehin (ON DELETE RESTRICT).
 */
export async function mustereAus(id: string, akteurId: string): Promise<GeraetAnsicht> {
  const geraet = await findeGeraet(id);
  if (geraet.status === "ausgegeben") {
    throw new RegelFehler(
      "Das Gerät ist noch ausgegeben. Bitte zuerst zurücknehmen, dann ausmustern.",
    );
  }
  await db()`
    UPDATE geraete SET status = 'ausgemustert', aktueller_nutzer_id = NULL,
                       rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
     WHERE id = ${id}`;
  return findeGeraet(id);
}

// ── Etiketten ──────────────────────────────────────────────────────────────

export async function listeBarcodes(
  geraetId: string,
): Promise<{ barcode: string; aktiv: boolean; erfasst_am: Date }[]> {
  return db()`
    SELECT barcode, aktiv, erfasst_am FROM geraete_barcodes
     WHERE geraet_id = ${geraetId} ORDER BY erfasst_am`;
}

/** Ersatzetikett hinzufügen. Das alte bleibt gültig. */
export async function ergaenzeBarcode(
  geraetId: string,
  roh: string,
  akteurId: string,
): Promise<string> {
  await findeGeraet(geraetId);
  const barcode = normalisiere(roh);

  if (codeArt(barcode) !== "geraet") {
    throw new RegelFehler(
      `"${barcode}" ist kein gültiger Geräte-Barcode. Codes mit "P-" gehören zu Lagerplätzen.`,
    );
  }

  const [schon] = await db()<{ geraet_id: string }[]>`
    SELECT geraet_id FROM geraete_barcodes WHERE barcode = ${barcode}`;
  if (schon) {
    throw new RegelFehler(
      schon.geraet_id === geraetId
        ? `Dieses Gerät trägt das Etikett ${barcode} bereits.`
        : `Das Etikett ${barcode} gehört bereits zu einem anderen Gerät.`,
    );
  }

  /**
   * Auch gegen das Register prüfen: Die Nummer kann auf einem Vorratsbogen
   * stehen oder beim Scannen aufgetaucht sein, ohne dass ein Gerät sie trägt.
   * Ein "gesehenes" Etikett klebt bereits irgendwo — es hier ein zweites Mal
   * zu vergeben, hieße dieselbe Nummer an zwei Maschinen.
   */
  const [imRegister] = await db()<{ zustand: string }[]>`
    SELECT zustand FROM etikettennummern WHERE nummer = ${barcode}`;
  if (imRegister?.zustand === "gesehen") {
    throw new RegelFehler(
      `Das Etikett ${barcode} ist beim Scannen bereits aufgetaucht und klebt damit auf ` +
        `einem Gerät, das noch nicht erfasst ist. Bitte eine andere Nummer verwenden.`,
    );
  }

  await db().begin(async (tx) => {
    await tx`INSERT INTO geraete_barcodes (barcode, geraet_id, erfasst_von)
             VALUES (${barcode}, ${geraetId}, ${akteurId})`;
    // Zusatzetikett: verbraucht, zählt aber nicht für den laufenden Kreis.
    await vergibNummerInTx(tx, barcode, geraetId, akteurId, false);
  });
  return barcode;
}

/**
 * Etikett stilllegen statt löschen: Taucht ein altes Etikett doch noch auf,
 * soll die App sagen können "das gehörte zu Gerät X", statt "unbekannt".
 */
export async function legeBarcodeStill(geraetId: string, roh: string): Promise<void> {
  const barcode = normalisiere(roh);
  const zeilen = await db()`
    UPDATE geraete_barcodes SET aktiv = FALSE
     WHERE barcode = ${barcode} AND geraet_id = ${geraetId} RETURNING barcode`;
  if (!zeilen.length) throw new NichtGefunden("Etikett");

  const [aktive] = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n FROM geraete_barcodes
     WHERE geraet_id = ${geraetId} AND aktiv`;
  if ((aktive?.n ?? 0) === 0) {
    // Rückgängig machen: ein Gerät ohne gültiges Etikett ist nicht mehr
    // scanbar und praktisch verschwunden.
    await db()`UPDATE geraete_barcodes SET aktiv = TRUE
                WHERE barcode = ${barcode} AND geraet_id = ${geraetId}`;
    throw new RegelFehler(
      "Das ist das letzte gültige Etikett. Bitte zuerst ein neues vergeben, " +
        "sonst lässt sich das Gerät nicht mehr scannen.",
    );
  }
}
