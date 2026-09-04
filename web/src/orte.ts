/**
 * Was die Oberfläche über Orte weiß, bevor der Server gefragt wird.
 *
 * Die Dublettenwarnung stand bis AP25 **dreimal** wortgleich da — in
 * `OrteView.vue`, `BuchenView.vue` und `BuchenDialog.vue`, jeweils mit dem
 * Kommentar „siehe OrteView". Drei Kopien einer Regel sind drei Gelegenheiten,
 * sie auseinanderlaufen zu lassen: Ändert jemand die Mindestlänge an einer
 * Stelle, warnt die Buchung ab drei Zeichen und die Ortsverwaltung ab vier,
 * und niemand kann sagen, welche Fassung gemeint war.
 */
import type { Standort } from "./typen";

/**
 * Trifft der eingetippte Name einen Ort, den es schon gibt?
 *
 * Der Hinweis erscheint, BEVOR gespeichert wird. Sonst entstehen mit der Zeit
 * „Lindengasse", „Lindengasse 14" und „lindengasse" nebeneinander, und der
 * Bestand verteilt sich auf drei Orte, die dasselbe meinen. Die Datenbank
 * verhindert nur exakte Dubletten unter den aktiven Orten.
 *
 * Unter drei Zeichen wird nicht gewarnt: „Li" steckt in jedem zweiten
 * Straßennamen, eine Warnung bei jedem Tastendruck liest bald niemand mehr.
 *
 * Reine Funktion, ohne Store und ohne Vue — dadurch ohne jsdom prüfbar.
 */
export function aehnlicherOrt(eingabe: string, standorte: Standort[]): Standort | null {
  const gesucht = eingabe.trim().toLowerCase();
  if (gesucht.length < 3) return null;
  return (
    standorte.find((s) => {
      const name = s.name.toLowerCase();
      return name === gesucht || name.includes(gesucht) || gesucht.includes(name);
    }) ?? null
  );
}
