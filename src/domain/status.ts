/**
 * Der Zustandsautomat eines Geräts.
 *
 * Reine Funktionen, ohne Datenbank und ohne HTTP — dadurch einzeln und
 * erschöpfend testbar. Das ist Absicht: Hier entscheidet sich, ob der
 * Bestand stimmt. Ein Fehler bedeutet, dass die App behauptet, ein Bagger
 * stünde im Lager, während er auf einer Baustelle steht.
 *
 *                  ausgabe                    ruecknahme
 *   verfuegbar ─────────────► ausgegeben ─────────────────► verfuegbar
 *       │  ▲                       │                            ▲
 *       │  │                       │ ruecknahme mit             │
 *       │  │                       │ schwere='ausfall'          │
 *       │  │                       ▼                            │
 *       │  └───────────────────  defekt ──► wartung ────────────┘
 *       │        (repariert)                  (fertig)
 *       │
 *       └──────────────► ausgemustert   (Endzustand, nur Admin)
 *
 *   umbuchung: ausgegeben → ausgegeben (nur Ort/Empfänger ändern sich)
 */

import { RegelFehler } from "../api/fehler.js";

export type Status = "verfuegbar" | "ausgegeben" | "wartung" | "defekt" | "ausgemustert";
export type Buchungsart = "ausgabe" | "ruecknahme" | "umbuchung" | "korrektur";

/**
 * Aus welchen Zuständen heraus eine Buchungsart erlaubt ist.
 *
 * Exportiert, weil die Oberfläche eine Zweitschrift davon hält
 * (`web/src/composables/useZubehoerwahl.ts`): Sie soll kein Zubehör
 * vorschlagen, das der Server anschließend ablehnen muss — sonst scheitert
 * eine Alles-oder-nichts-Buchung an einem Teil, das der Benutzer nie
 * angefasst hat. Durchgesetzt wird die Regel weiterhin nur hier; ein Test
 * hält beide Seiten zusammen, wie es `tests/domain-rechte.test.ts` für die
 * Rechtelisten vormacht.
 */
export const ERLAUBT: Record<Buchungsart, Status[]> = {
  ausgabe: ["verfuegbar"],
  ruecknahme: ["ausgegeben"],
  umbuchung: ["ausgegeben"],
  // Korrekturen müssen aus jedem Zustand möglich sein — sie sind das Werkzeug,
  // um einen falschen Zustand geradezurücken. Nur Admin, mit Begründung.
  korrektur: ["verfuegbar", "ausgegeben", "wartung", "defekt"],
};

/** Der Zustand, in dem das Gerät nach der Buchung ist. */
export function folgeStatus(vorher: Status, art: Buchungsart, ausfall = false): Status {
  switch (art) {
    case "ausgabe":
      return "ausgegeben";
    case "ruecknahme":
      // Ein Ausfallschaden nimmt das Gerät sofort aus dem Umlauf. Sonst
      // gäbe jemand am nächsten Morgen ein kaputtes Gerät wieder aus.
      return ausfall ? "defekt" : "verfuegbar";
    case "umbuchung":
      return "ausgegeben";
    case "korrektur":
      return vorher;
  }
}

/**
 * Prüft, ob die Buchung aus dem aktuellen Zustand heraus zulässig ist.
 * Wirft mit einer Meldung, die dem Benutzer sagt, was zu tun ist —
 * nicht nur, dass etwas nicht geht.
 */
export function pruefeUebergang(vorher: Status, art: Buchungsart): void {
  if (ERLAUBT[art].includes(vorher)) return;

  const meldung: Record<string, string> = {
    "ausgabe:ausgegeben":
      "Dieses Gerät ist bereits ausgegeben. Bitte zuerst zurücknehmen oder umbuchen.",
    "ausgabe:defekt":
      "Dieses Gerät ist als defekt gemeldet und lässt sich nicht ausgeben. " +
      "Erst nach der Reparatur wieder freigeben.",
    "ausgabe:wartung": "Dieses Gerät ist in Wartung und lässt sich derzeit nicht ausgeben.",
    "ausgabe:ausgemustert": "Dieses Gerät ist ausgemustert.",
    "ruecknahme:verfuegbar": "Dieses Gerät ist gar nicht ausgegeben — es steht bereits im Bestand.",
    "ruecknahme:defekt": "Dieses Gerät ist nicht ausgegeben, sondern als defekt vermerkt.",
    "ruecknahme:wartung": "Dieses Gerät ist nicht ausgegeben, sondern in Wartung.",
    "ruecknahme:ausgemustert": "Dieses Gerät ist ausgemustert.",
    "umbuchung:verfuegbar":
      "Umbuchen geht nur bei ausgegebenen Geräten. Dieses steht im Bestand — bitte ausgeben.",
    "korrektur:ausgemustert": "Ausgemusterte Geräte lassen sich nicht mehr korrigieren.",
  };

  throw new RegelFehler(
    meldung[`${art}:${vorher}`] ?? `"${art}" ist im Zustand "${vorher}" nicht möglich.`,
    `${art}:${vorher}`,
  );
}

export interface Aktion {
  art: Buchungsart;
  text: string;
  hauptaktion: boolean;
}

/**
 * Welche Aktionen die Oberfläche nach einem Scan anbieten darf.
 *
 * Die Liste kommt vom Server, nicht aus dem Frontend — sonst laufen
 * Oberfläche und Regelwerk früher oder später auseinander, und der
 * Benutzer tippt auf einen Knopf, der dann eine Fehlermeldung liefert.
 *
 * `darfBuchen` ist das Recht `buchungen.erfassen`. **Ohne Standardwert, und
 * das ist der Punkt:** Mit `= true` bekäme ein künftiger Aufrufer, der den
 * Parameter vergisst, still alle Aktionen — der Schutz wäre wirkungslos, ohne
 * dass irgendwo etwas meldet. So zwingt der Übersetzer jeden Aufrufer zur
 * Entscheidung, und die Gegenprobe "Parameter weglassen" wird ein Typfehler
 * statt eines stillen `true`.
 */
export function erlaubteAktionen(status: Status, darfBuchen: boolean): Aktion[] {
  const aktionen: Aktion[] = [];

  // Alles, was diese Liste anbietet, ist eine Buchung. Ohne das Recht bleibt
  // sie leer — sonst zeigt die Oberfläche Knöpfe, die der Server anschließend
  // mit 403 abweist, und der Benutzer erfährt erst nach dem Tippen, dass er
  // nicht darf.
  if (!darfBuchen) return aktionen;

  switch (status) {
    case "verfuegbar":
      aktionen.push({ art: "ausgabe", text: "Ausgeben", hauptaktion: true });
      break;
    case "ausgegeben":
      aktionen.push({ art: "ruecknahme", text: "Zurücknehmen", hauptaktion: true });
      aktionen.push({ art: "umbuchung", text: "Auf andere Baustelle", hauptaktion: false });
      break;
    case "defekt":
    case "wartung":
      // Bewusst keine Aktion: Wer ein defektes Gerät wieder freigeben will,
      // erledigt den Schaden — das ist ein anderer Vorgang als eine Buchung.
      break;
    case "ausgemustert":
      break;
  }

  /**
   * "Bestand berichtigen" wird hier bewusst NICHT mehr angeboten.
   *
   * Der Knopf hat nie funktioniert: Er führte auf einen Weg, der ein
   * `POST /buchungen` mit `art: "korrektur"` abschickte, und `buchungsSchema`
   * in `api/routes/buchungen.ts` kennt nur ausgabe/ruecknahme/umbuchung — die
   * Antwort war 400. Berichtigt wird über `POST /buchungen/korrektur`, und
   * das ist ein eigener Vorgang mit Pflicht-Begründung, keine Folgeaktion
   * eines Scans.
   */

  return aktionen;
}

/** Erklärt in einem Satz, warum gerade nichts gebucht werden kann. */
export function hinweisZuStatus(status: Status): string | null {
  switch (status) {
    case "defekt":
      return "Das Gerät ist als defekt gemeldet. Es lässt sich erst nach Erledigung des Schadens wieder ausgeben.";
    case "wartung":
      return "Das Gerät ist in Wartung.";
    case "ausgemustert":
      return "Das Gerät ist ausgemustert und nicht mehr im Umlauf.";
    default:
      return null;
  }
}
