/**
 * Schlagworte, Standorte und Lagerplätze.
 *
 * Alles drei legt der Betrieb selbst an — nichts ist vorgegeben.
 */

import { db } from "../db/client.js";
import { naechsterPlatzCode, normalisiere, PLATZ_PRAEFIX } from "../domain/barcode.js";
import { NichtGefunden, RegelFehler } from "../api/fehler.js";

// ── Schlagworte ────────────────────────────────────────────────────────────

export interface Schlagwort {
  id: string;
  name: string;
  farbe: string | null;
  sort_order: number;
}

export async function listeSchlagworte(): Promise<Schlagwort[]> {
  return db()<Schlagwort[]>`
    SELECT id, name, farbe, sort_order FROM schlagworte ORDER BY sort_order, name`;
}

export async function legeSchlagwortAn(daten: {
  name: string;
  farbe?: string | null;
}): Promise<Schlagwort> {
  const name = daten.name.trim();
  if (!name) throw new RegelFehler("Das Schlagwort braucht einen Namen.");

  // CITEXT macht den Namen unabhängig von Groß-/Kleinschreibung eindeutig;
  // ohne die eigene Prüfung käme hier nur ein nackter Datenbankfehler.
  const [schon] = await db()`SELECT id FROM schlagworte WHERE name = ${name}`;
  if (schon) throw new RegelFehler(`Das Schlagwort "${name}" gibt es bereits.`);

  const zeilen = await db()<Schlagwort[]>`
    INSERT INTO schlagworte (name, farbe) VALUES (${name}, ${daten.farbe ?? null})
    RETURNING id, name, farbe, sort_order`;
  return zeilen[0]!;
}

export async function findeSchlagwort(id: string): Promise<Schlagwort> {
  const zeilen = await db()<Schlagwort[]>`
    SELECT id, name, farbe, sort_order FROM schlagworte WHERE id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Schlagwort");
  return zeilen[0];
}

export async function aendereSchlagwort(
  id: string,
  daten: { name?: string; farbe?: string | null; sort_order?: number },
): Promise<Schlagwort> {
  const alt = await findeSchlagwort(id);
  const name = daten.name?.trim() || alt.name;

  if (name.toLowerCase() !== alt.name.toLowerCase()) {
    const [schon] = await db()`SELECT id FROM schlagworte WHERE name = ${name} AND id <> ${id}`;
    if (schon) throw new RegelFehler(`Das Schlagwort "${name}" gibt es bereits.`);
  }

  const zeilen = await db()<Schlagwort[]>`
    UPDATE schlagworte SET
      name       = ${name},
      farbe      = ${daten.farbe === undefined ? alt.farbe : daten.farbe},
      sort_order = ${daten.sort_order ?? alt.sort_order}
    WHERE id = ${id}
    RETURNING id, name, farbe, sort_order`;
  return zeilen[0]!;
}

export async function loescheSchlagwort(id: string): Promise<void> {
  // Die Zuordnungen verschwinden per CASCADE mit. Geräte bleiben unberührt —
  // ein Schlagwort ist eine Sicht auf den Bestand, kein Bestandteil davon.
  const zeilen = await db()`DELETE FROM schlagworte WHERE id = ${id} RETURNING id`;
  if (!zeilen.length) throw new NichtGefunden("Schlagwort");
}

// ── Standorte ──────────────────────────────────────────────────────────────

export type StandortTyp = "lager" | "baustelle" | "werkstatt" | "extern";

export interface Standort {
  id: string;
  name: string;
  typ: StandortTyp;
  adresse: string | null;
  notiz: string | null;
  aktiv: boolean;
}

export async function listeStandorte(nurAktive = false): Promise<Standort[]> {
  return nurAktive
    ? db()<Standort[]>`
        SELECT id, name, typ, adresse, notiz, aktiv FROM standorte
         WHERE aktiv ORDER BY typ, name`
    : db()<Standort[]>`
        SELECT id, name, typ, adresse, notiz, aktiv FROM standorte
         ORDER BY aktiv DESC, typ, name`;
}

export async function findeStandort(id: string): Promise<Standort> {
  const zeilen = await db()<Standort[]>`
    SELECT id, name, typ, adresse, notiz, aktiv FROM standorte WHERE id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Standort");
  return zeilen[0];
}

export async function legeStandortAn(daten: {
  name: string;
  typ: StandortTyp;
  adresse?: string | null;
  notiz?: string | null;
}): Promise<Standort> {
  const name = daten.name.trim();
  if (!name) throw new RegelFehler("Der Standort braucht einen Namen.");

  const [schon] = await db()`
    SELECT id FROM standorte WHERE lower(name) = lower(${name}) AND aktiv`;
  if (schon) throw new RegelFehler(`Es gibt bereits einen aktiven Standort "${name}".`);

  const zeilen = await db()<Standort[]>`
    INSERT INTO standorte (name, typ, adresse, notiz)
    VALUES (${name}, ${daten.typ}, ${daten.adresse ?? null}, ${daten.notiz ?? null})
    RETURNING id, name, typ, adresse, notiz, aktiv`;
  return zeilen[0]!;
}

export async function aendereStandort(
  id: string,
  daten: {
    name?: string;
    typ?: StandortTyp;
    adresse?: string | null;
    notiz?: string | null;
    aktiv?: boolean;
  },
): Promise<Standort> {
  const alt = await findeStandort(id);
  const name = daten.name?.trim() || alt.name;

  if (name.toLowerCase() !== alt.name.toLowerCase()) {
    const [schon] = await db()`
      SELECT id FROM standorte WHERE lower(name) = lower(${name}) AND aktiv AND id <> ${id}`;
    if (schon) throw new RegelFehler(`Es gibt bereits einen aktiven Standort "${name}".`);
  }

  const zeilen = await db()<Standort[]>`
    UPDATE standorte SET
      name    = ${name},
      typ     = ${daten.typ ?? alt.typ},
      adresse = ${daten.adresse === undefined ? alt.adresse : daten.adresse},
      notiz   = ${daten.notiz === undefined ? alt.notiz : daten.notiz},
      aktiv   = ${daten.aktiv === undefined ? alt.aktiv : daten.aktiv},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING id, name, typ, adresse, notiz, aktiv`;
  return zeilen[0]!;
}

/**
 * Was steht an diesem Ort?
 * Beantwortet die zweithäufigste Frage im Alltag nach "wo ist Gerät X".
 */
export async function bestandAmStandort(id: string): Promise<
  {
    id: string;
    inventarnummer: string | null;
    bezeichnung: string;
    status: string;
    lagerplatz: string | null;
    seit: Date | null;
  }[]
> {
  return db()`
    SELECT g.id, g.inventarnummer, g.bezeichnung, g.status,
           p.bezeichnung AS lagerplatz,
           (SELECT max(b.zeitpunkt) FROM buchungen b
             WHERE b.geraet_id = g.id AND b.nach_standort_id = ${id}) AS seit
      FROM geraete g
      LEFT JOIN lagerplaetze p ON p.id = g.aktueller_lagerplatz_id
     WHERE g.aktueller_standort_id = ${id}
       AND g.status <> 'ausgemustert'
     ORDER BY g.bezeichnung`;
}

// ── Lagerplätze ────────────────────────────────────────────────────────────

export type PlatzTyp = "regal" | "fach" | "container" | "freiflaeche";

export interface Lagerplatz {
  id: string;
  standort_id: string;
  bezeichnung: string;
  barcode: string | null;
  typ: PlatzTyp;
  notiz: string | null;
  aktiv: boolean;
  sort_order: number;
}

export async function listeLagerplaetze(standortId?: string): Promise<Lagerplatz[]> {
  const felder = db()`id, standort_id, bezeichnung, barcode, typ, notiz, aktiv, sort_order`;
  return standortId
    ? db()<Lagerplatz[]>`
        SELECT ${felder} FROM lagerplaetze WHERE standort_id = ${standortId}
         ORDER BY aktiv DESC, sort_order, bezeichnung`
    : db()<Lagerplatz[]>`
        SELECT ${felder} FROM lagerplaetze ORDER BY aktiv DESC, sort_order, bezeichnung`;
}

export async function findeLagerplatz(id: string): Promise<Lagerplatz> {
  const zeilen = await db()<Lagerplatz[]>`
    SELECT id, standort_id, bezeichnung, barcode, typ, notiz, aktiv, sort_order
      FROM lagerplaetze WHERE id = ${id}`;
  if (!zeilen[0]) throw new NichtGefunden("Lagerplatz");
  return zeilen[0];
}

export async function findeLagerplatzNachCode(code: string): Promise<Lagerplatz | null> {
  const zeilen = await db()<Lagerplatz[]>`
    SELECT id, standort_id, bezeichnung, barcode, typ, notiz, aktiv, sort_order
      FROM lagerplaetze WHERE barcode = ${normalisiere(code)}`;
  return zeilen[0] ?? null;
}

/**
 * Legt einen Lagerplatz an. Ohne ausdrücklichen Code wird der nächste freie
 * vergeben — so muss sich niemand Nummern merken.
 */
export async function legeLagerplatzAn(daten: {
  standort_id: string;
  bezeichnung: string;
  typ?: PlatzTyp;
  barcode?: string | null;
  notiz?: string | null;
}): Promise<Lagerplatz> {
  const bezeichnung = daten.bezeichnung.trim();
  if (!bezeichnung) throw new RegelFehler("Der Lagerplatz braucht eine Bezeichnung.");

  await findeStandort(daten.standort_id); // wirft, wenn es den Ort nicht gibt

  let barcode: string;
  if (daten.barcode) {
    barcode = normalisiere(daten.barcode);
    if (!barcode.startsWith(PLATZ_PRAEFIX)) {
      throw new RegelFehler(
        `Der Code eines Lagerplatzes muss mit "${PLATZ_PRAEFIX}" beginnen — ` +
          `das hält ihn von Gerätenummern getrennt.`,
      );
    }
    const [schon] = await db()`SELECT id FROM lagerplaetze WHERE barcode = ${barcode}`;
    if (schon) throw new RegelFehler(`Den Code "${barcode}" gibt es bereits.`);
  } else {
    barcode = await naechsterFreierPlatzCode();
  }

  const zeilen = await db()<Lagerplatz[]>`
    INSERT INTO lagerplaetze (standort_id, bezeichnung, barcode, typ, notiz)
    VALUES (${daten.standort_id}, ${bezeichnung}, ${barcode},
            ${daten.typ ?? "regal"}, ${daten.notiz ?? null})
    RETURNING id, standort_id, bezeichnung, barcode, typ, notiz, aktiv, sort_order`;
  return zeilen[0]!;
}

async function naechsterFreierPlatzCode(): Promise<string> {
  const [hoechster] = await db()<{ barcode: string }[]>`
    SELECT barcode FROM lagerplaetze
     WHERE barcode IS NOT NULL ORDER BY barcode DESC LIMIT 1`;
  return naechsterPlatzCode(hoechster?.barcode ?? null);
}

export async function aendereLagerplatz(
  id: string,
  daten: { bezeichnung?: string; typ?: PlatzTyp; notiz?: string | null; aktiv?: boolean },
): Promise<Lagerplatz> {
  const alt = await findeLagerplatz(id);
  const zeilen = await db()<Lagerplatz[]>`
    UPDATE lagerplaetze SET
      bezeichnung = ${daten.bezeichnung?.trim() || alt.bezeichnung},
      typ         = ${daten.typ ?? alt.typ},
      notiz       = ${daten.notiz === undefined ? alt.notiz : daten.notiz},
      aktiv       = ${daten.aktiv === undefined ? alt.aktiv : daten.aktiv},
      updated_at  = NOW()
    WHERE id = ${id}
    RETURNING id, standort_id, bezeichnung, barcode, typ, notiz, aktiv, sort_order`;
  return zeilen[0]!;
}

/** Was liegt in diesem Regal? */
export async function bestandAmLagerplatz(id: string): Promise<
  { id: string; inventarnummer: string | null; bezeichnung: string; status: string }[]
> {
  return db()`
    SELECT id, inventarnummer, bezeichnung, status FROM geraete
     WHERE aktueller_lagerplatz_id = ${id} AND status <> 'ausgemustert'
     ORDER BY bezeichnung`;
}
