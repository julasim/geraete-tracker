/**
 * Welche Haltung die Oberfläche gerade einnimmt.
 *
 * Die Anwendung kennt genau **zwei** Haltungen und **einen** Umbruchpunkt:
 * unter 1024 px eine Spalte mit unterer Navigationsleiste (Baustelle,
 * Daumen, teils Handschuhe), ab 1024 px Seitenleiste plus dichte Tabelle
 * (Schreibtisch, Maus). Drei Haltungen wären nicht mehr begreifbar.
 *
 * `tablet` ist **keine dritte Haltung**, sondern eine Abtönung der breiten:
 * Ein iPad quer bekommt dasselbe Gerüst, aber Tippziele von 44 px und eine
 * Kartenliste statt der Tabelle — mit dem Finger trifft niemand eine 48 px
 * hohe Tabellenzeile mit einem 18 px großen Kästchen darin.
 *
 * Warum überhaupt in JavaScript und nicht nur als Medienabfrage in CSS:
 * Die untere Leiste soll im breiten Modus **gar nicht erst im DOM landen**.
 * Nur versteckt führte sie Tastatur und Vorlesehilfe durch eine zweite,
 * unsichtbare Navigation.
 *
 * Die Werte sind bewusst auf Modulebene abgelegt, nicht je Komponente:
 * Sonst hinge an jeder Ansicht ein eigener Beobachter an derselben Abfrage.
 * Für Tests heißt das umgekehrt, dass sich `breit.value` vor dem Einhängen
 * einer Komponente direkt setzen lässt — jsdom wertet Medienabfragen nicht
 * aus und meldet immer `false`.
 */
import { ref } from "vue";

/** Ab hier Seitenleiste. Die Grenze steht an genau dieser einen Stelle. */
export const BREIT_AB = "(min-width: 1024px)";

/**
 * Breit, aber mit dem Finger bedient: iPad quer (1024–1279 px) oder ein
 * beliebig breiter Bildschirm ohne genauen Zeiger. Ein Touch-Notebook mit
 * 1920 px fällt damit ebenfalls in diese Abtönung — das ist gewollt, denn
 * es wird ja tatsächlich getippt.
 */
export const TABLET_AB = "(min-width: 1024px) and (max-width: 1279px), (pointer: coarse)";

const breit = ref(false);
const tablet = ref(false);

let angebunden = false;

function anbinden(): void {
  if (angebunden || typeof window === "undefined" || !window.matchMedia) return;
  angebunden = true;

  const koppeln = (abfrage: string, ziel: typeof breit) => {
    const mq = window.matchMedia(abfrage);
    ziel.value = mq.matches;
    // Absichtlich ohne Abmelden: Die Beobachter leben so lange wie die
    // Seite. Ein Abmelden je Komponente würde die geteilten Werte für alle
    // anderen Ansichten mit abschalten.
    mq.addEventListener("change", (e) => (ziel.value = e.matches));
  };

  koppeln(BREIT_AB, breit);
  koppeln(TABLET_AB, tablet);
}

export function useBreite(): { breit: typeof breit; tablet: typeof tablet } {
  anbinden();
  return { breit, tablet };
}
