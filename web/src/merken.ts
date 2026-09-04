/**
 * Was sich die Oberfläche zwischen zwei Buchungen merkt.
 *
 * Wer im Bauhof zehn Geräte auf dieselbe Baustelle gibt, soll das Ziel
 * einmal wählen und nicht zehnmal. Deshalb steht der zuletzt gewählte Ort
 * je Buchungsart im localStorage.
 *
 * Der Schlüssel steht hier und nicht in den vier Ansichten, die ihn
 * benutzen: Er lag dort als Literal viermal herum — dreimal als Präfix
 * `"gt-letzter-ort"` samt angehängter Art, einmal fertig zusammengesetzt
 * als `"gt-letzter-ort-ausgabe"`. Dass alle vier denselben Wert ergaben,
 * war Glück, nicht Absicht: Ein Tippfehler in einer davon hätte ein zweites
 * Gedächtnis für dieselbe Gewohnheit aufgemacht, und niemand hätte es
 * gemerkt — die Vorbelegung wäre einfach manchmal leer geblieben.
 */
import type { Buchungsart } from "./typen";

/** Der Schlüssel für den zuletzt gewählten Ort einer Buchungsart. */
export function letzterOrt(art: Buchungsart): string {
  return `gt-letzter-ort-${art}`;
}
