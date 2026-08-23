/**
 * Wann wurde zuletzt gesichert?
 *
 * Die Sicherung läuft nachts per cron. Scheitert sie, merkt es sonst
 * niemand — bis sie gebraucht wird, und dann ist es zu spät. Es gibt in
 * dieser Anwendung bewusst keinen Mailversand, also nimmt die Meldung den
 * umgekehrten Weg: `scripts/sicherung.sh` legt den Ausgang jedes Laufs als
 * Datei ab, und die Übersicht zeigt ihn an. Wer die App öffnet, sieht es.
 *
 * Bewusst kein Eintrag in der Datenbank: Die Sicherung muss auch dann noch
 * melden können, wenn genau die Datenbank das Problem ist.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA_PATH } from "../config.js";

export interface SicherungsStand {
  ausgang: "erfolg" | "fehler";
  zeitpunkt: string;
  stempel: string;
  ziel: string;
  meldung: string;
  /** Tage seit dem letzten Lauf — für die Anzeige ausgerechnet. */
  tage_her: number;
}

const STAND_DATEI = "sicherung-stand.json";

/**
 * Liest den letzten Stand. `null` heißt: Es wurde noch nie gesichert (oder
 * die Datei liegt woanders) — das ist kein Fehler, sondern der Zustand einer
 * frischen Anlage, und die Oberfläche sagt genau das.
 */
export async function letzteSicherung(): Promise<SicherungsStand | null> {
  try {
    const roh = await readFile(resolve(DATA_PATH, STAND_DATEI), "utf8");
    const daten = JSON.parse(roh) as Omit<SicherungsStand, "tage_her">;

    const zeit = new Date(daten.zeitpunkt).getTime();
    if (!Number.isFinite(zeit)) return null;

    return {
      ...daten,
      tage_her: Math.floor((Date.now() - zeit) / 86_400_000),
    };
  } catch {
    // Datei fehlt, ist unlesbar oder kein JSON. In allen drei Fällen gilt
    // dasselbe: Es gibt keinen belegbaren Stand, und Raten hilft niemandem.
    return null;
  }
}
