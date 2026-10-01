/**
 * Die Bremse gegen Passwortraten.
 *
 * Drei Stufen, die zusammenwirken:
 *   1. Wachsende Verzögerung  — für einen Vertipper unmerklich, für ein
 *      Rateprogramm tödlich.
 *   2. Kontosperre            — nach N Fehlversuchen ist Schluss, egal von
 *                               welcher Adresse aus probiert wird.
 *   3. Ratenbegrenzung nach IP — bremst denjenigen, der viele Konten
 *                               durchprobiert.
 *
 * Warum getrennt nach Konto UND nach IP: Wer nur nach Konto bremst, lässt
 * jemanden mit einer Liste von 500 Benutzernamen gewähren. Wer nur nach IP
 * bremst, lässt ein Botnetz gewähren.
 */

import { SPERRE_MINUTEN, SPERRE_NACH_VERSUCHEN } from "../config.js";
import { fehlversucheVonIp } from "../data/benutzer.js";

/** Ab dem wievielten Fehlversuch überhaupt verzögert wird. */
const AB_VERSUCH = 3;
/** Obergrenze, damit eine Anfrage nicht ewig offen bleibt. */
const MAX_WARTE_MS = 8_000;

/**
 * Wartezeit nach einem Fehlversuch: 1 s, 2 s, 4 s, 8 s, 8 s …
 * Die ersten beiden Versuche bleiben ungebremst — wer sich vertippt,
 * soll es nicht merken.
 */
export function warteZeitMs(fehlversuche: number): number {
  if (fehlversuche < AB_VERSUCH) return 0;
  return Math.min(2 ** (fehlversuche - AB_VERSUCH) * 1000, MAX_WARTE_MS);
}

export async function warte(ms: number): Promise<void> {
  if (ms > 0) await new Promise((f) => setTimeout(f, ms));
}

export interface SperrStand {
  gesperrt: boolean;
  bisSekunden: number;
}

/** Ist das Konto gerade gesperrt, und wie lange noch? */
export function pruefeSperre(gesperrtBis: Date | null): SperrStand {
  if (!gesperrtBis) return { gesperrt: false, bisSekunden: 0 };
  const rest = gesperrtBis.getTime() - Date.now();
  if (rest <= 0) return { gesperrt: false, bisSekunden: 0 };
  return { gesperrt: true, bisSekunden: Math.ceil(rest / 1000) };
}

/**
 * Zu viele Fehlversuche von dieser Adresse im Zeitfenster?
 *
 * Bewusst über die Datenbank statt über eine Map im Speicher: Die Grenze soll
 * einen Neustart der App überstehen, sonst genügt es zu warten, bis der
 * Container einmal durchstartet.
 */
export async function ipUeberlastet(ip: string | null): Promise<boolean> {
  if (!ip) return false;
  const anzahl = await fehlversucheVonIp(ip, SPERRE_MINUTEN);
  // Doppelte Kontogrenze: eine Werkstatt teilt sich womöglich eine Adresse,
  // und mehrere Leute vertippen sich dort unabhängig voneinander.
  return anzahl >= SPERRE_NACH_VERSUCHEN * 2;
}

/**
 * Ermittelt die Adresse des Anfragenden.
 *
 * Die App steht hinter Caddy (nicht Cloudflare), der X-Forwarded-For setzt.
 * CF-Connecting-IP und X-Real-IP kommen vom Client und sind fälschbar —
 * deshalb nur X-Forwarded-For vertrauen (Caddy schreibt die echte IP als
 * erstes Element) und die fälschbaren Header ignorieren.
 */
export function klientIp(c: {
  req: { header(name: string): string | undefined };
}): string | null {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return (xff.split(",")[0] ?? "").trim() || null;
  return null;
}
