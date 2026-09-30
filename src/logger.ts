/**
 * Schlichtes Protokoll auf stdout, eine JSON-Zeile je Eintrag.
 * Docker sammelt stdout ohnehin ein — eine eigene Dateiverwaltung wäre
 * doppelte Arbeit mit doppelten Fehlerquellen.
 *
 * Wichtig: Geheimnisse werden herausgefiltert, BEVOR etwas geschrieben wird.
 * Ein Passwort im Protokoll ist ein Passwortleck, auch wenn das Protokoll
 * "nur lokal" liegt.
 */

import { LOG_LEVEL } from "./config.js";

type Stufe = "debug" | "info" | "warn" | "error";
const RANG: Record<Stufe, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SCHWELLE = RANG[(LOG_LEVEL as Stufe) in RANG ? (LOG_LEVEL as Stufe) : "info"];

/** Feldnamen, deren Inhalt nie im Protokoll landen darf. */
const GEHEIM = /passwor|secret|token|cookie|authorization|hash|geheim/i;

function saeubere(wert: unknown, tiefe = 0): unknown {
  if (tiefe > 6) return "…";
  if (wert === null || typeof wert !== "object") return wert;
  if (Array.isArray(wert)) return wert.map((e) => saeubere(e, tiefe + 1));
  if (wert instanceof Error) {
    return { name: wert.name, message: wert.message, stack: wert.stack };
  }
  const raus: Record<string, unknown> = {};
  for (const [schluessel, inhalt] of Object.entries(wert)) {
    raus[schluessel] = GEHEIM.test(schluessel) ? "[entfernt]" : saeubere(inhalt, tiefe + 1);
  }
  return raus;
}

function schreibe(stufe: Stufe, text: string, daten?: Record<string, unknown>): void {
  if (RANG[stufe] < SCHWELLE) return;
  const zeile = {
    zeit: new Date().toISOString(),
    stufe,
    text,
    ...(daten ? (saeubere(daten) as Record<string, unknown>) : {}),
  };
  const ausgabe = JSON.stringify(zeile);
  if (stufe === "error" || stufe === "warn") process.stderr.write(ausgabe + "\n");
  else process.stdout.write(ausgabe + "\n");
}

export const logInfo = (text: string, daten?: Record<string, unknown>) =>
  schreibe("info", text, daten);
export const logWarn = (text: string, daten?: Record<string, unknown>) =>
  schreibe("warn", text, daten);
export const logError = (text: string, daten?: Record<string, unknown>) =>
  schreibe("error", text, daten);
