/**
 * Welches Recht ein Zielpfad verlangt — an einer Stelle.
 *
 * Ein Knopf, der auf eine geschützte Ansicht führt, muss dasselbe Recht
 * prüfen wie die Route dahinter. Solange beide Stellen ihr Recht als Literal
 * tragen, laufen sie auseinander: Der Rückwurf des Routers ist stumm (bei
 * fehlendem Recht landet man wortlos in `/geraete`), der Benutzer sammelt
 * also zehn Geräte, drückt „Ausgeben“ und steht ohne Erklärung in der
 * Geräteliste. Deshalb steht die Zuordnung hier — und `router.ts` liest sie,
 * statt sie ein zweites Mal zu schreiben.
 *
 * **Die Richtung ist wichtig:** `router.ts` importiert dieses Modul, niemals
 * umgekehrt. `createRouter()` läuft beim Modulladen; sechs Testdateien
 * ersetzen `vue-router` durch eine Teilfabrik ohne `createRouter`. Zöge eine
 * Ansicht über `@/rechte-pfade` den Router nach, wäre `createRouter` dort
 * `undefined` und die ganze Datei rot.
 *
 * Bewusst **keine Direktive `v-recht`**: Sie versteckt die Bedingung vor
 * `grep` und vor `scripts/pruefe-oberflaeche.mjs`. In einem Projekt, das
 * gerade Werkzeuge gegen genau solche Fehler baut, wäre das ein Rückschritt.
 *
 * Die Rechte selbst sind die des Servers (`src/api/routes/*`, `darf(...)`) —
 * die Oberfläche erfindet hier nichts, sie spiegelt nur.
 */
import { useAnmeldung } from "@/stores/anmeldung";

export interface Pfadrecht {
  /** Das Routenmuster aus `router.ts`; `:name` steht für ein Segment. */
  muster: string;
  /** Das Recht, das der Server für diese Ansicht verlangt. */
  recht: string;
}

/**
 * Alle Ansichten, die ein Recht verlangen.
 *
 * Was hier fehlt, ist für jeden Angemeldeten erreichbar — Lesen ist in dieser
 * Anwendung kein Recht. Die Reihenfolge entscheidet bei Überschneidungen:
 * `/benutzer/neu` steht vor `/benutzer/:id`, damit die feste Schreibweise
 * gewinnt (hier belanglos, beide verlangen dasselbe — aber die Regel soll
 * gelten, bevor sie einmal nicht mehr belanglos ist).
 */
export const RECHT_JE_PFAD: readonly Pfadrecht[] = [
  { muster: "/geraete/neu", recht: "geraete.pflegen" },
  { muster: "/geraete/:id/bearbeiten", recht: "geraete.pflegen" },
  { muster: "/buchen/:id/:art", recht: "buchungen.erfassen" },
  { muster: "/sammeln/:art", recht: "buchungen.erfassen" },
  { muster: "/etiketten", recht: "etiketten.drucken" },
  { muster: "/austausch", recht: "daten.austauschen" },
  { muster: "/benutzer/neu", recht: "benutzer.verwalten" },
  { muster: "/benutzer/:id", recht: "benutzer.verwalten" },
  { muster: "/benutzer", recht: "benutzer.verwalten" },
  { muster: "/rollen", recht: "benutzer.verwalten" },
];

/**
 * Die Segmente eines Pfads, ohne Abfrage und Anker.
 *
 * `/geraete?status=ausgegeben` kommt in der Oberfläche wirklich vor
 * (Übersicht → „Alle ausgegebenen Geräte zeigen“). Ohne das Abschneiden
 * verglichen wir `geraete?status=ausgegeben` gegen `geraete` und fänden nie
 * einen Treffer.
 */
function segmente(pfad: string): string[] {
  return pfad.split(/[?#]/, 1)[0]!.split("/").filter(Boolean);
}

function passt(muster: string, pfad: string): boolean {
  const m = segmente(muster);
  const p = segmente(pfad);
  if (m.length !== p.length) return false;
  return m.every((teil, i) => (teil.startsWith(":") ? p[i]!.length > 0 : teil === p[i]));
}

/**
 * Welches Recht verlangt dieser Pfad? `undefined` heißt: keines.
 *
 * Nimmt sowohl den konkreten Pfad (`/geraete/abc-123/bearbeiten`) als auch
 * das Muster (`/geraete/:id/bearbeiten`) — der Router prüft den einen, die
 * Knöpfe den anderen, und beide sollen durch dieselbe Funktion laufen.
 */
export function rechtFuer(pfad: string): string | undefined {
  return RECHT_JE_PFAD.find((e) => passt(e.muster, pfad))?.recht;
}

/**
 * Darf der angemeldete Benutzer dorthin?
 *
 * Für Knöpfe: `v-if="darfNach('/sammeln/ausgabe')"`. Ein Pfad ohne Eintrag
 * ist frei — die Antwort ist dann `true`, nicht `false`. Andernfalls
 * verschwänden bei jedem vergessenen Eintrag Knöpfe, die funktionieren.
 */
export function darfNach(pfad: string): boolean {
  const recht = rechtFuer(pfad);
  return !recht || useAnmeldung().darf(recht);
}
