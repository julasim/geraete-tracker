/**
 * Bestand aus- und einlesen.
 *
 * Das Prüfen der Zeilen steckt in `src/domain/import.ts` (reine Funktion,
 * ohne Datenbank). Hier steht nur, was gelesen und geschrieben wird.
 */

import type postgres from "postgres";
import { db } from "../db/client.js";
import { RegelFehler } from "../api/fehler.js";
import { datumFuerExport, schreibeCsv, zahlFuerExport } from "../domain/csv.js";
import {
  pruefeZeilen,
  SPALTEN,
  type GepruefteZeile,
  type Pruefergebnis,
  type VorhandenesGeraet,
} from "../domain/import.js";

/** Der Bestand, wie ihn die Import-Prüfung braucht. */
export async function bestandFuerAbgleich(): Promise<VorhandenesGeraet[]> {
  return db()<VorhandenesGeraet[]>`
    SELECT g.id, g.inventarnummer, g.bezeichnung, g.hersteller, g.modell,
           g.seriennummer, g.anschaffungsdatum, g.anschaffungswert,
           g.betriebsstunden, g.notiz, g.rev,
           coalesce((
             SELECT json_agg(json_build_object('id', w.id, 'name', w.name) ORDER BY w.name)
               FROM geraet_schlagworte gs JOIN schlagworte w ON w.id = gs.schlagwort_id
              WHERE gs.geraet_id = g.id
           ), '[]'::json) AS schlagworte
      FROM geraete g
     WHERE g.status <> 'ausgemustert'
     ORDER BY g.inventarnummer`;
}

/**
 * Der Export.
 *
 * Enthält Standort, Zustand und Nutzer als Information — beim Import sind
 * sie wirkungslos, weil sie sich aus Buchungen ergeben. Die Spaltennamen
 * sagen das ausdrücklich.
 *
 * Die Fassungsnummer wandert mit: Nur so lässt sich beim Import erkennen,
 * ob jemand das Gerät zwischenzeitlich bearbeitet hat.
 */
export async function exportiere(): Promise<string> {
  const zeilen = await db()<
    {
      inventarnummer: string | null;
      bezeichnung: string;
      hersteller: string | null;
      modell: string | null;
      seriennummer: string | null;
      anschaffungsdatum: string | null;
      anschaffungswert: string | null;
      betriebsstunden: string | null;
      schlagworte: string | null;
      notiz: string | null;
      rev: number;
      status: string;
      standort: string | null;
      lagerplatz: string | null;
      nutzer: string | null;
    }[]
  >`
    SELECT g.inventarnummer, g.bezeichnung, g.hersteller, g.modell, g.seriennummer,
           g.anschaffungsdatum, g.anschaffungswert, g.betriebsstunden, g.notiz, g.rev,
           g.status,
           s.name AS standort, p.bezeichnung AS lagerplatz, b.anzeigename AS nutzer,
           (SELECT string_agg(w.name, ', ' ORDER BY w.name)
              FROM geraet_schlagworte gs JOIN schlagworte w ON w.id = gs.schlagwort_id
             WHERE gs.geraet_id = g.id) AS schlagworte
      FROM geraete g
      LEFT JOIN standorte    s ON s.id = g.aktueller_standort_id
      LEFT JOIN lagerplaetze p ON p.id = g.aktueller_lagerplatz_id
      LEFT JOIN benutzer     b ON b.id = g.aktueller_nutzer_id
     WHERE g.status <> 'ausgemustert'
     ORDER BY g.inventarnummer NULLS LAST`;

  const spalten = [
    SPALTEN.inventarnummer,
    SPALTEN.bezeichnung,
    SPALTEN.hersteller,
    SPALTEN.modell,
    SPALTEN.seriennummer,
    SPALTEN.anschaffungsdatum,
    SPALTEN.anschaffungswert,
    SPALTEN.betriebsstunden,
    SPALTEN.schlagworte,
    SPALTEN.notiz,
    SPALTEN.rev,
    SPALTEN.status,
    SPALTEN.standort,
    SPALTEN.lagerplatz,
    SPALTEN.nutzer,
  ];

  const daten = zeilen.map((z) => ({
    [SPALTEN.inventarnummer]: z.inventarnummer ?? "",
    [SPALTEN.bezeichnung]: z.bezeichnung,
    [SPALTEN.hersteller]: z.hersteller ?? "",
    [SPALTEN.modell]: z.modell ?? "",
    [SPALTEN.seriennummer]: z.seriennummer ?? "",
    [SPALTEN.anschaffungsdatum]: datumFuerExport(z.anschaffungsdatum),
    [SPALTEN.anschaffungswert]: zahlFuerExport(z.anschaffungswert),
    [SPALTEN.betriebsstunden]: zahlFuerExport(z.betriebsstunden),
    [SPALTEN.schlagworte]: z.schlagworte ?? "",
    [SPALTEN.notiz]: z.notiz ?? "",
    [SPALTEN.rev]: z.rev,
    [SPALTEN.status]: z.status,
    [SPALTEN.standort]: z.standort ?? "",
    [SPALTEN.lagerplatz]: z.lagerplatz ?? "",
    [SPALTEN.nutzer]: z.nutzer ?? "",
  }));

  return schreibeCsv(spalten, daten);
}

export async function pruefeImport(zeilen: Record<string, string>[]): Promise<Pruefergebnis> {
  const [bestand, worte] = await Promise.all([
    bestandFuerAbgleich(),
    db()<{ name: string }[]>`SELECT name FROM schlagworte`,
  ]);
  return pruefeZeilen(zeilen, bestand, worte.map((w) => w.name));
}

export interface ImportErgebnis {
  angelegt: number;
  geaendert: number;
  uebersprungen: number;
  neueSchlagworte: number;
}

/**
 * Schreibt den Import — ALLES in einer Transaktion.
 *
 * Bricht Zeile 147 ab, ist auch Zeile 1 nicht geschrieben. Ein zur Hälfte
 * importierter Bestand wäre schlimmer als gar keiner: Niemand wüsste, wo
 * die Grenze verlief, und ein zweiter Versuch legte die ersten 146 doppelt an.
 *
 * Die Nummernvergabe läuft über dieselbe Sperre wie beim einzelnen Anlegen
 * (siehe naechsteFreieNummerInTx in data/geraete.ts) — deshalb wird sie hier
 * einmal für den ganzen Lauf gehalten und nicht je Zeile neu geholt.
 */
export async function schreibeImport(
  ergebnis: Pruefergebnis,
  akteurId: string,
): Promise<ImportErgebnis> {
  if (!ergebnis.schreibbar) {
    throw new RegelFehler(
      "Der Import enthält Fehler oder Konflikte und wird deshalb nicht geschrieben.",
    );
  }

  const SPERRE_NUMMERNKREIS = 7_319_777;
  let angelegt = 0;
  let geaendert = 0;

  await db().begin(async (tx) => {
    // Einmal für den ganzen Lauf. Andere Anlagen warten so lange —
    // bei 200 Zeilen sind das Bruchteile einer Sekunde.
    await tx`SELECT pg_advisory_xact_lock(${SPERRE_NUMMERNKREIS})`;

    // Fehlende Schlagworte zuerst anlegen, damit die Zuordnung unten greift.
    const wortId = new Map<string, string>();
    const vorhandeneWorte = await tx<{ id: string; name: string }[]>`
      SELECT id, name FROM schlagworte`;
    for (const w of vorhandeneWorte) wortId.set(w.name.toLowerCase(), w.id);

    for (const name of ergebnis.neueSchlagworte) {
      if (wortId.has(name.toLowerCase())) continue;
      const [neu] = await tx<{ id: string }[]>`
        INSERT INTO schlagworte (name) VALUES (${name}) RETURNING id`;
      wortId.set(name.toLowerCase(), neu!.id);
    }

    // Höchste Nummer einmal lesen und selbst hochzählen — 200 Mal dieselbe
    // Abfrage wäre unnötig, und die Sperre halten wir ohnehin.
    const [hoechste] = await tx<{ inventarnummer: string }[]>`
      SELECT inventarnummer FROM geraete
       WHERE inventarnummer ~ '^[0-9]+$'
       ORDER BY inventarnummer::bigint DESC LIMIT 1`;
    let naechste = Number(hoechste?.inventarnummer ?? 10_000);

    for (const zeile of ergebnis.zeilen) {
      if (zeile.art === "unveraendert") continue;

      if (zeile.art === "neu") {
        const nummer = zeile.inventarnummer ?? String(++naechste).padStart(5, "0");
        if (zeile.inventarnummer) {
          const alsZahl = Number(zeile.inventarnummer);
          if (Number.isFinite(alsZahl) && alsZahl > naechste) naechste = alsZahl;
        }
        await legeAn(tx, zeile, nummer, akteurId, wortId);
        angelegt++;
      } else if (zeile.art === "geaendert") {
        await aendere(tx, zeile, akteurId, wortId);
        geaendert++;
      }
    }
  });

  return {
    angelegt,
    geaendert,
    uebersprungen: ergebnis.unveraendert,
    neueSchlagworte: ergebnis.neueSchlagworte.length,
  };
}

type Tx = postgres.TransactionSql;

async function legeAn(
  tx: Tx,
  zeile: GepruefteZeile,
  nummer: string,
  akteurId: string,
  wortId: Map<string, string>,
): Promise<void> {
  const w = zeile.werte;
  const [neu] = await tx<{ id: string }[]>`
    INSERT INTO geraete (inventarnummer, bezeichnung, hersteller, modell, seriennummer,
                         anschaffungsdatum, anschaffungswert, betriebsstunden, notiz,
                         created_by, updated_by)
    VALUES (${nummer}, ${String(w.bezeichnung)}, ${w.hersteller ?? null},
            ${w.modell ?? null}, ${w.seriennummer ?? null},
            ${(w.anschaffungsdatum as string | null) ?? null},
            ${(w.anschaffungswert as number | null) ?? null},
            ${(w.betriebsstunden as number | null) ?? null},
            ${w.notiz ?? null}, ${akteurId}, ${akteurId})
    RETURNING id`;

  await tx`INSERT INTO geraete_barcodes (barcode, geraet_id, erfasst_von)
           VALUES (${nummer}, ${neu!.id}, ${akteurId})`;

  await setzeSchlagworte(tx, neu!.id, zeile.schlagworte, wortId);
}

async function aendere(
  tx: Tx,
  zeile: GepruefteZeile,
  akteurId: string,
  wortId: Map<string, string>,
): Promise<void> {
  const w = zeile.werte;

  // Den bisherigen Stand lesen und ausdrücklich einsetzen, wo die Datei
  // nichts vorgibt.
  //
  // Das ist der Kern von Julius' Vorgabe: Eine leere Zelle heißt "nicht
  // ändern", nicht "löschen". Wer in Excel versehentlich eine Spalte
  // markiert und löscht, darf damit keine 200 Angaben vernichten.
  // Ein ausdrückliches Leeren kommt als null an (Bindestrich in der Zelle).
  const [alt] = await tx<
    {
      hersteller: string | null;
      modell: string | null;
      seriennummer: string | null;
      anschaffungsdatum: string | null;
      anschaffungswert: string | null;
      betriebsstunden: string | null;
      notiz: string | null;
    }[]
  >`SELECT hersteller, modell, seriennummer, anschaffungsdatum,
           anschaffungswert, betriebsstunden, notiz
      FROM geraete WHERE id = ${zeile.geraetId!}`;
  if (!alt) return;

  const nimm = <T>(neuWert: T | undefined, alterWert: T): T =>
    neuWert === undefined ? alterWert : neuWert;

  await tx`
    UPDATE geraete SET
      bezeichnung       = ${String(w.bezeichnung)},
      hersteller        = ${nimm(w.hersteller as string | null | undefined, alt.hersteller)},
      modell            = ${nimm(w.modell as string | null | undefined, alt.modell)},
      seriennummer      = ${nimm(w.seriennummer as string | null | undefined, alt.seriennummer)},
      anschaffungsdatum = ${nimm(w.anschaffungsdatum as string | null | undefined, alt.anschaffungsdatum)},
      anschaffungswert  = ${nimm(w.anschaffungswert as number | null | undefined, alt.anschaffungswert as unknown as number | null)},
      betriebsstunden   = ${nimm(w.betriebsstunden as number | null | undefined, alt.betriebsstunden as unknown as number | null)},
      notiz             = ${nimm(w.notiz as string | null | undefined, alt.notiz)},
      rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
    WHERE id = ${zeile.geraetId!}`;

  if (zeile.schlagworte) {
    await tx`DELETE FROM geraet_schlagworte WHERE geraet_id = ${zeile.geraetId!}`;
    await setzeSchlagworte(tx, zeile.geraetId!, zeile.schlagworte, wortId);
  }
}

async function setzeSchlagworte(
  tx: Tx,
  geraetId: string,
  namen: string[] | undefined,
  wortId: Map<string, string>,
): Promise<void> {
  if (!namen?.length) return;
  const ids = namen.map((n) => wortId.get(n.toLowerCase())).filter((id): id is string => Boolean(id));
  if (!ids.length) return;
  await tx`INSERT INTO geraet_schlagworte ${tx(
    ids.map((schlagwort_id) => ({ geraet_id: geraetId, schlagwort_id })),
  )} ON CONFLICT DO NOTHING`;
}
