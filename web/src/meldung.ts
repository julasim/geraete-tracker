/**
 * Aus einem gefangenen Wurf einen Satz machen, den man dem Benutzer zeigen
 * kann.
 *
 * Die Kette stand an vier Stellen wortgleich:
 *
 *   f instanceof ApiError ? f.message
 *     : f instanceof Error ? f.message
 *     : "Buchung fehlgeschlagen"
 *
 * Der erste Zweig war immer überflüssig — `ApiError` erbt von `Error` und
 * liefert dieselbe `message`. Er stand nur da, weil beim Kopieren niemand
 * mehr nachsah. Hier bleibt eine Prüfung übrig, und der Ersatztext ist das
 * Einzige, was der Aufrufer noch wählt.
 *
 * Der Wortlaut des Servers geht **unverändert** durch: Er nennt bei einer
 * Sammelbuchung das Gerät beim Namen („Rüttelplatte (10011): …"), und
 * `SammelPanel` erkennt es allein an diesem Anfang wieder. Ein hier
 * angehängtes „Bitte erneut versuchen" würde das nicht stören, ein
 * vorangestelltes sehr wohl.
 *
 * Nicht in `api.ts`: Die Datei beschreibt den Zugang zur API, nicht die
 * Anzeige. Wo etwas hingeschrieben wird, entscheidet der Aufrufer.
 */
export function meldungAus(fehler: unknown, ersatz: string): string {
  return fehler instanceof Error && fehler.message ? fehler.message : ersatz;
}
