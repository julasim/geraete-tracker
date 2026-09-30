/**
 * Pakete — benannte Zusammenstellungen für die Sammelbuchung.
 *
 * Für eine Estrich-Baustelle fahren immer dieselben acht Geräte mit. Ein
 * Paket hält diese Liste fest, damit sie nicht jedes Mal einzeln
 * zusammengescannt werden muss.
 *
 * **Ein Paket hat keinen eigenen Bestand.** Es zeigt nur auf Geräte; wo
 * etwas steht, sagt allein das Gerät. Gäbe es zwei Wahrheiten darüber,
 * liefen sie irgendwann auseinander — und falscher Bestand ist in dieser
 * Anwendung der teuerste Fehler.
 */

import type postgres from "postgres";
import { db } from "../db/client.js";
import { NichtGefunden } from "../api/fehler.js";

export interface Paket {
  id: string;
  name: string;
  notiz: string | null;
  aktiv: boolean;
  rev: number;
  /** Wie viele Geräte hängen daran? Für die Liste. */
  anzahl: number;
}

export interface PaketGeraet {
  id: string;
  inventarnummer: string | null;
  bezeichnung: string;
  status: string;
  standort: string | null;
}

export async function listePakete(nurAktive = true): Promise<Paket[]> {
  return db()<Paket[]>`
    SELECT p.id, p.name, p.notiz, p.aktiv, p.rev,
           (SELECT count(*)::int FROM paket_geraete pg WHERE pg.paket_id = p.id) AS anzahl
      FROM pakete p
     WHERE ${nurAktive ? db()`p.aktiv` : db()`TRUE`}
     ORDER BY p.name`;
}

export async function findePaket(id: string): Promise<Paket> {
  const [paket] = await db()<Paket[]>`
    SELECT p.id, p.name, p.notiz, p.aktiv, p.rev,
           (SELECT count(*)::int FROM paket_geraete pg WHERE pg.paket_id = p.id) AS anzahl
      FROM pakete p WHERE p.id = ${id}`;
  if (!paket) throw new NichtGefunden("Paket");
  return paket;
}

/** Die Geräte eines Pakets, mit ihrem aktuellen Zustand. */
export async function paketGeraete(paketId: string): Promise<PaketGeraet[]> {
  return db()<PaketGeraet[]>`
    SELECT g.id, g.inventarnummer, g.bezeichnung, g.status, s.name AS standort
      FROM paket_geraete pg
      JOIN geraete g ON g.id = pg.geraet_id
      LEFT JOIN standorte s ON s.id = g.aktueller_standort_id
     WHERE pg.paket_id = ${paketId}
     ORDER BY pg.sort_order, g.bezeichnung`;
}

export async function legePaketAn(
  daten: { name: string; notiz?: string | null; geraet_ids?: string[] },
  akteurId: string,
): Promise<Paket> {
  // Erst committen, dann lesen: `findePaket` fragt über `db()`, sieht die
  // Zeile also NICHT, solange die Transaktion offen ist — der Aufruf lieferte
  // "Paket nicht gefunden" und die Route antwortete mit 404, obwohl das Paket
  // längst angelegt war. Dasselbe Muster wie bei `buche()`: Die Transaktion
  // gibt die Id zurück, gelesen wird danach.
  const id = await db().begin(async (tx) => {
    const [paket] = await tx<{ id: string }[]>`
      INSERT INTO pakete (name, notiz, updated_by)
      VALUES (${daten.name.trim()}, ${daten.notiz?.trim() || null}, ${akteurId})
      RETURNING id`;
    await setzeGeraete(tx, paket!.id, daten.geraet_ids ?? []);
    return paket!.id;
  });
  return findePaket(id);
}

export async function aenderePaket(
  id: string,
  daten: { name?: string; notiz?: string | null; aktiv?: boolean; geraet_ids?: string[] },
  akteurId: string,
): Promise<Paket> {
  await findePaket(id);
  await db().begin(async (tx) => {
    if (daten.name !== undefined || daten.notiz !== undefined || daten.aktiv !== undefined) {
      await tx`
        UPDATE pakete SET
          name  = ${daten.name?.trim() ?? db()`name`},
          notiz = ${daten.notiz === undefined ? db()`notiz` : (daten.notiz?.trim() || null)},
          aktiv = ${daten.aktiv ?? db()`aktiv`},
          rev = rev + 1, updated_at = NOW(), updated_by = ${akteurId}
        WHERE id = ${id}`;
    }
    if (daten.geraet_ids) await setzeGeraete(tx, id, daten.geraet_ids);
  });
  // Nach dem Commit lesen — siehe legePaketAn.
  return findePaket(id);
}

/**
 * Setzt die Geräteliste eines Pakets — ersetzend, nicht ergänzend.
 *
 * Die Reihenfolge wird mitgespeichert: Wer ein Paket zusammenstellt, ordnet
 * es meist so, wie geladen wird. Beim Abhaken auf dem Hänger hilft das.
 */
async function setzeGeraete(
  tx: postgres.TransactionSql,
  paketId: string,
  geraetIds: string[],
): Promise<void> {
  const eindeutig = [...new Set(geraetIds)];
  await tx`DELETE FROM paket_geraete WHERE paket_id = ${paketId}`;
  if (!eindeutig.length) return;

  const [vorhanden] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM geraete WHERE id = ANY(${eindeutig})`;
  if ((vorhanden?.n ?? 0) !== eindeutig.length) {
    throw new NichtGefunden("Gerät");
  }

  await tx`
    INSERT INTO paket_geraete ${tx(
      eindeutig.map((geraet_id, i) => ({ paket_id: paketId, geraet_id, sort_order: i })),
    )}`;
}

export async function loeschePaket(id: string): Promise<void> {
  const paket = await findePaket(id);
  // Ein Paket hält keinen Bestand und steht in keiner Historie — es darf
  // wirklich verschwinden. Die Zuordnungen gehen per CASCADE mit.
  if (!paket) throw new NichtGefunden("Paket");
  await db()`DELETE FROM pakete WHERE id = ${id}`;
}

/**
 * Das Zubehör eines Geräts — die Löffel zum Bagger.
 *
 * Bewusst **eine Ebene tief** (so ist auch das Datenmodell angelegt):
 * Zubehör von Zubehör gibt es nicht, und niemand vermisst es.
 */
export async function zubehoerVon(geraetId: string): Promise<PaketGeraet[]> {
  return db()<PaketGeraet[]>`
    SELECT g.id, g.inventarnummer, g.bezeichnung, g.status, s.name AS standort
      FROM geraete g
      LEFT JOIN standorte s ON s.id = g.aktueller_standort_id
     WHERE g.gehoert_zu_id = ${geraetId}
       AND g.status <> 'ausgemustert'
     ORDER BY g.bezeichnung`;
}

