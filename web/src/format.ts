/**
 * Darstellungshilfen, die mehr als eine Ansicht braucht.
 *
 * Angelegt, als die Übersicht am Computer dieselbe Restfrist zeigen sollte
 * wie die Fristenliste. Kopieren wäre der Anfang zweier Wahrheiten gewesen:
 * Ändert jemand die eine Formulierung, steht in der anderen Ansicht weiter
 * die alte.
 */

import type { Ampel } from "./typen";

/**
 * Die Restfrist in Worten.
 *
 * „in 3 Tagen" ist im Bauhof brauchbarer als ein Datum, das man erst gegen
 * den Kalender halten muss — beim Datum selbst bleibt es trotzdem, weil der
 * Prüftermin danach vereinbart wird.
 */
export function frist(tage: number): string {
  if (tage < -1) return `seit ${Math.abs(tage)} Tagen`;
  if (tage === -1) return "seit gestern";
  if (tage === 0) return "heute";
  if (tage === 1) return "morgen";
  return `in ${tage} Tagen`;
}

/** Die Chip-Klasse zur Ampel einer Prüfung. */
export function ampelKlasse(ampel: Ampel): string {
  if (ampel === "ueberfaellig") return "pt-chip--defekt";
  if (ampel === "faellig") return "pt-chip--warnung";
  return "pt-chip--neutral";
}

/**
 * Wie lange ein Gerät schon draußen ist, in Worten.
 *
 * Bewusst anders als `frist()`: Dort geht es um eine Frist in der Zukunft,
 * hier um eine Dauer in der Vergangenheit — „seit 21 Tagen" statt „in 21
 * Tagen". Dieselbe Zahl, entgegengesetzte Bedeutung.
 */
export function dauer(tage: number): string {
  if (tage <= 0) return "heute";
  if (tage === 1) return "seit gestern";
  return `seit ${tage} Tagen`;
}
