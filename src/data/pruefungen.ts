/**
 * Prüfungen — vorerst nur lesend.
 *
 * Das Eintragen kommt in AP8. Der Lesezugriff steht schon hier, weil die
 * Warnung beim Scannen dazugehört: Eine abgelaufene Prüfung muss auf der
 * Gerätekarte auffallen, nicht in einer Liste, die niemand aufmacht.
 */

import { db } from "../db/client.js";

export interface FaelligeMeldung {
  pruefart: string;
  geprueft_am: Date;
  naechste_faellig: Date;
  ergebnis: string;
  ueberfaellig: boolean;
  tage_bis_faellig: number;
}

/**
 * Der Prüfstand eines Geräts — je Prüfart die jeweils jüngste Eintragung.
 *
 * DISTINCT ON ist hier genau richtig: Von zehn Jahren E-Prüfungen zählt nur
 * die letzte, denn sie bestimmt, wann die nächste fällig ist.
 */
export async function faelligeFuerGeraet(geraetId: string): Promise<FaelligeMeldung[]> {
  return db()<FaelligeMeldung[]>`
    SELECT DISTINCT ON (p.pruefart_id)
           a.name AS pruefart,
           p.geprueft_am,
           p.naechste_faellig,
           p.ergebnis,
           (p.naechste_faellig < CURRENT_DATE) AS ueberfaellig,
           (p.naechste_faellig - CURRENT_DATE)::int AS tage_bis_faellig
      FROM geraet_pruefungen p
      JOIN pruefarten a ON a.id = p.pruefart_id
     WHERE p.geraet_id = ${geraetId}
     ORDER BY p.pruefart_id, p.geprueft_am DESC`;
}

// ── Schreiben (AP8) ─────────────────────────────────────────────────────────

import { NichtGefunden, RegelFehler } from "../api/fehler.js";
import { alsIsoDatum, ausIsoDatum, naechsteFaelligkeit } from "../domain/pruefung.js";

export interface Pruefart {
  id: string;
  name: string;
  intervall_monate: number;
  notiz: string | null;
  aktiv: boolean;
}

export async function listePruefarten(): Promise<Pruefart[]> {
  return db()<Pruefart[]>`
    SELECT id, name, intervall_monate, notiz, aktiv FROM pruefarten
     ORDER BY aktiv DESC, name`;
}

export async function legePruefartAn(daten: {
  name: string;
  intervall_monate: number;
  notiz?: string | null;
}): Promise<Pruefart> {
  const name = daten.name.trim();
  if (!name) throw new RegelFehler("Die Prüfart braucht einen Namen.");
  if (daten.intervall_monate < 1 || daten.intervall_monate > 600) {
    throw new RegelFehler("Das Intervall muss zwischen 1 und 600 Monaten liegen.");
  }

  const [schon] = await db()`SELECT id FROM pruefarten WHERE name = ${name}`;
  if (schon) throw new RegelFehler(`Die Prüfart "${name}" gibt es bereits.`);

  const zeilen = await db()<Pruefart[]>`
    INSERT INTO pruefarten (name, intervall_monate, notiz)
    VALUES (${name}, ${daten.intervall_monate}, ${daten.notiz ?? null})
    RETURNING id, name, intervall_monate, notiz, aktiv`;
  return zeilen[0]!;
}

/**
 * Trägt eine Prüfung ein. Die nächste Fälligkeit rechnet der Server aus
 * Prüfdatum und Intervall — nie der Browser.
 */
export async function tragePruefungEin(
  daten: {
    geraet_id: string;
    pruefart_id: string;
    geprueft_am: string;
    ergebnis: "bestanden" | "maengel" | "durchgefallen";
    pruefer?: string | null;
    notiz?: string | null;
  },
  akteurId: string,
): Promise<{ id: string; naechste_faellig: Date }> {
  const [art] = await db()<{ intervall_monate: number }[]>`
    SELECT intervall_monate FROM pruefarten WHERE id = ${daten.pruefart_id}`;
  if (!art) throw new NichtGefunden("Prüfart");

  let geprueft: Date;
  try {
    geprueft = ausIsoDatum(daten.geprueft_am);
  } catch {
    throw new RegelFehler("Das Prüfdatum ist unbrauchbar.");
  }
  if (Number.isNaN(geprueft.getTime())) throw new RegelFehler("Das Prüfdatum ist unbrauchbar.");
  if (geprueft.getTime() > Date.now() + 86_400_000) {
    throw new RegelFehler("Das Prüfdatum liegt in der Zukunft.");
  }

  const faellig = naechsteFaelligkeit(geprueft, art.intervall_monate);

  const zeilen = await db()<{ id: string; naechste_faellig: Date }[]>`
    INSERT INTO geraet_pruefungen (geraet_id, pruefart_id, geprueft_am, naechste_faellig,
                                   ergebnis, pruefer, notiz, erfasst_von)
    VALUES (${daten.geraet_id}, ${daten.pruefart_id}, ${daten.geprueft_am},
            ${alsIsoDatum(faellig)}, ${daten.ergebnis},
            ${daten.pruefer ?? null}, ${daten.notiz ?? null}, ${akteurId})
    RETURNING id, naechste_faellig`;

  return zeilen[0]!;
}

/** Alles, was ansteht — für die Ampelliste. */
export async function alleFaelligen(): Promise<
  {
    geraet_id: string;
    inventarnummer: string | null;
    bezeichnung: string;
    status: string;
    pruefart: string;
    geprueft_am: Date;
    naechste_faellig: Date;
    tage_bis_faellig: number;
  }[]
> {
  return db()`
    SELECT DISTINCT ON (p.geraet_id, p.pruefart_id)
           g.id AS geraet_id, g.inventarnummer, g.bezeichnung, g.status,
           a.name AS pruefart, p.geprueft_am, p.naechste_faellig,
           (p.naechste_faellig - CURRENT_DATE)::int AS tage_bis_faellig
      FROM geraet_pruefungen p
      JOIN pruefarten a ON a.id = p.pruefart_id
      JOIN geraete    g ON g.id = p.geraet_id
     WHERE g.status <> 'ausgemustert'
     ORDER BY p.geraet_id, p.pruefart_id, p.geprueft_am DESC`;
}

export async function pruefungenFuerGeraet(geraetId: string): Promise<
  {
    id: string;
    pruefart: string;
    geprueft_am: Date;
    naechste_faellig: Date;
    ergebnis: string;
    pruefer: string | null;
    notiz: string | null;
  }[]
> {
  return db()`
    SELECT p.id, a.name AS pruefart, p.geprueft_am, p.naechste_faellig,
           p.ergebnis, p.pruefer, p.notiz
      FROM geraet_pruefungen p JOIN pruefarten a ON a.id = p.pruefart_id
     WHERE p.geraet_id = ${geraetId}
     ORDER BY p.geprueft_am DESC`;
}
