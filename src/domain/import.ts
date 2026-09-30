/**
 * Import-Zeilen prüfen und einordnen.
 *
 * Reine Funktion, ohne Datenbank: Die Vorschau soll sich testen lassen, ohne
 * dass irgendwo etwas geschrieben wird — und genau das ist die Zusicherung,
 * die dem Benutzer gegeben wird.
 *
 * Zwei Regeln prägen alles hier, beide von Julius vorgegeben:
 *
 *   1. UNVOLLSTÄNDIGE ZEILEN WERDEN ANGELEGT. Pflicht ist ausschließlich die
 *      Bezeichnung. Wer 200 Maschinen erfasst, kennt nicht bei jeder die
 *      Seriennummer.
 *
 *   2. EINE LEERE ZELLE ÄNDERT NICHTS. Steht in der App "Wacker Neuson" und
 *      ist die Zelle leer, bleibt der Wert stehen. Der Grund ist der
 *      wahrscheinlichste Weg zum Datenverlust: Wer in Excel versehentlich
 *      eine Spalte löscht, würde sonst mit einem Import 200 Angaben
 *      vernichten. Absichtlich löschen geht über einen Bindestrich.
 */

import { datumAus, LEEREN, zahlAus } from "./csv.js";
import { normalisiere } from "./barcode.js";

/** Spaltenüberschriften, wie sie der Export schreibt und der Import erwartet. */
export const SPALTEN = {
  inventarnummer: "Inventarnummer",
  bezeichnung: "Bezeichnung",
  hersteller: "Hersteller",
  modell: "Modell",
  seriennummer: "Seriennummer",
  anschaffungsdatum: "Anschaffungsdatum",
  anschaffungswert: "Anschaffungswert",
  betriebsstunden: "Betriebsstunden",
  schlagworte: "Schlagworte",
  notiz: "Notiz",
  rev: "Fassung",
  // Nur zur Information — beim Import wirkungslos.
  status: "Status (nur Information)",
  standort: "Standort (nur Information)",
  lagerplatz: "Lagerplatz (nur Information)",
  nutzer: "Bei wem (nur Information)",
} as const;

/** Die Felder, die der Import tatsächlich schreibt. */
type Feld =
  | "bezeichnung"
  | "hersteller"
  | "modell"
  | "seriennummer"
  | "anschaffungsdatum"
  | "anschaffungswert"
  | "betriebsstunden"
  | "notiz"
  | "schlagworte";

export interface VorhandenesGeraet {
  id: string;
  inventarnummer: string | null;
  bezeichnung: string;
  hersteller: string | null;
  modell: string | null;
  seriennummer: string | null;
  anschaffungsdatum: string | null;
  anschaffungswert: string | null;
  betriebsstunden: string | null;
  notiz: string | null;
  rev: number;
  schlagworte: { id: string; name: string }[];
}

type ZeilenArt = "neu" | "geaendert" | "unveraendert" | "konflikt" | "fehler";

export interface GepruefteZeile {
  /** Zeilennummer in der Datei, wie der Benutzer sie in Excel sieht (Kopfzeile = 1). */
  nummer: number;
  art: ZeilenArt;
  inventarnummer: string | null;
  bezeichnung: string;
  /** Bei "geaendert": was sich ändert. Leere Zellen tauchen hier NICHT auf. */
  aenderungen: { feld: Feld; alt: string; neu: string }[];
  /** Bei "fehler" und "konflikt": warum. */
  meldung?: string;
  /** Die aufbereiteten Werte für den Schreibvorgang. */
  werte: Partial<Record<Feld, string | number | null>>;
  /** Namen der Schlagworte aus der Datei — werden beim Schreiben aufgelöst. */
  schlagworte?: string[];
  geraetId?: string;
  rev?: number;
}

export interface Pruefergebnis {
  zeilen: GepruefteZeile[];
  neu: number;
  geaendert: number;
  unveraendert: number;
  konflikte: number;
  fehler: number;
  /** Schlagworte aus der Datei, die es noch nicht gibt — werden angelegt. */
  neueSchlagworte: string[];
  /** Nur wenn nichts fehlerhaft ist, darf geschrieben werden. */
  schreibbar: boolean;
  hinweise: string[];
}

/** Liest ein Feld aus der Zeile, egal wie die Spalte geschrieben wurde. */
function feld(zeile: Record<string, string>, name: string): string {
  const treffer = Object.keys(zeile).find(
    (k) => k.toLowerCase().replace(/\s+/g, "") === name.toLowerCase().replace(/\s+/g, ""),
  );
  return treffer ? (zeile[treffer] ?? "").trim() : "";
}

/**
 * Wandelt einen Zellwert in das, was geschrieben werden soll.
 *
 *   leer          → undefined  (nichts ändern)
 *   Bindestrich   → null       (ausdrücklich leeren)
 *   sonst         → der Wert
 */
function wertAus(roh: string): string | null | undefined {
  const text = roh.trim();
  if (!text) return undefined;
  if (text === LEEREN) return null;
  return text;
}

export function pruefeZeilen(
  zeilen: Record<string, string>[],
  vorhanden: VorhandenesGeraet[],
  bekannteSchlagworte: string[],
): Pruefergebnis {
  const nachNummer = new Map(
    vorhanden.filter((g) => g.inventarnummer).map((g) => [normalisiere(g.inventarnummer!), g]),
  );
  const schlagwortVorhanden = new Set(bekannteSchlagworte.map((s) => s.toLowerCase()));
  const neueSchlagworte = new Set<string>();
  const hinweise: string[] = [];
  const gesehen = new Set<string>();

  const gepruefte: GepruefteZeile[] = zeilen.map((zeile, i) => {
    const nummer = i + 2; // Kopfzeile ist Zeile 1
    const bezeichnung = feld(zeile, SPALTEN.bezeichnung);
    const invRoh = feld(zeile, SPALTEN.inventarnummer);
    const inv = invRoh ? normalisiere(invRoh) : null;

    const basis: GepruefteZeile = {
      nummer,
      art: "neu",
      inventarnummer: inv,
      bezeichnung,
      aenderungen: [],
      werte: {},
    };

    // Die einzige Pflicht.
    if (!bezeichnung) {
      return { ...basis, art: "fehler", meldung: "Die Bezeichnung fehlt." };
    }

    // Dieselbe Nummer zweimal in einer Datei — sonst überschriebe die zweite
    // Zeile stillschweigend die erste.
    if (inv) {
      if (gesehen.has(inv)) {
        return {
          ...basis,
          art: "fehler",
          meldung: `Die Nummer ${inv} kommt in der Datei mehrfach vor.`,
        };
      }
      gesehen.add(inv);
    }

    // Zahlen und Daten umwandeln — hier scheitern die typischen Excel-Werte.
    const werte: GepruefteZeile["werte"] = {};
    try {
      werte.bezeichnung = bezeichnung;

      const einfach: [Feld, string][] = [
        ["hersteller", SPALTEN.hersteller],
        ["modell", SPALTEN.modell],
        ["seriennummer", SPALTEN.seriennummer],
        ["notiz", SPALTEN.notiz],
      ];
      for (const [ziel, spalte] of einfach) {
        const wert = wertAus(feld(zeile, spalte));
        if (wert !== undefined) werte[ziel] = wert;
      }

      const datumRoh = feld(zeile, SPALTEN.anschaffungsdatum);
      const datum = wertAus(datumRoh);
      if (datum === null) werte.anschaffungsdatum = null;
      else if (datum !== undefined) werte.anschaffungsdatum = datumAus(datum) ?? null;

      const wertRoh = feld(zeile, SPALTEN.anschaffungswert);
      const anschaffung = wertAus(wertRoh);
      if (anschaffung === null) werte.anschaffungswert = null;
      else if (anschaffung !== undefined) werte.anschaffungswert = zahlAus(anschaffung) ?? null;

      const stundenRoh = feld(zeile, SPALTEN.betriebsstunden);
      const stunden = wertAus(stundenRoh);
      if (stunden === null) werte.betriebsstunden = null;
      else if (stunden !== undefined) werte.betriebsstunden = zahlAus(stunden) ?? null;
    } catch (fehler) {
      return {
        ...basis,
        art: "fehler",
        meldung: fehler instanceof Error ? fehler.message : "Unbrauchbarer Wert.",
      };
    }

    // Schlagworte: durch Komma getrennt, Groß-/Kleinschreibung egal.
    const worteRoh = feld(zeile, SPALTEN.schlagworte);
    let schlagworte: string[] | undefined;
    if (worteRoh.trim() === LEEREN) {
      schlagworte = [];
    } else if (worteRoh.trim()) {
      schlagworte = worteRoh
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const wort of schlagworte) {
        if (!schlagwortVorhanden.has(wort.toLowerCase())) neueSchlagworte.add(wort);
      }
    }

    const alt = inv ? nachNummer.get(inv) : undefined;

    // ── Neu ────────────────────────────────────────────────────────────
    if (!alt) {
      return {
        ...basis,
        art: "neu",
        werte,
        ...(schlagworte ? { schlagworte } : {}),
      };
    }

    // ── Vorhanden: Fassung prüfen ──────────────────────────────────────
    const revRoh = feld(zeile, SPALTEN.rev);
    if (revRoh) {
      const revInDatei = Number(revRoh);
      if (Number.isFinite(revInDatei) && revInDatei !== alt.rev) {
        return {
          ...basis,
          art: "konflikt",
          geraetId: alt.id,
          meldung:
            `Das Gerät wurde seit dem Export geändert (Fassung ${alt.rev} statt ${revInDatei}). ` +
            `Aktuell steht dort: "${alt.bezeichnung}".`,
        };
      }
    }

    // ── Was ändert sich wirklich? ──────────────────────────────────────
    // Nur Felder mit Inhalt. Eine leere Zelle taucht hier bewusst NICHT
    // auf — sonst wären nach jedem Export-Import-Durchlauf 200 Zeilen
    // "geändert", ohne dass sich etwas ändert.
    const aenderungen: GepruefteZeile["aenderungen"] = [];
    const vergleich: [Feld, unknown][] = [
      ["bezeichnung", alt.bezeichnung],
      ["hersteller", alt.hersteller],
      ["modell", alt.modell],
      ["seriennummer", alt.seriennummer],
      ["anschaffungsdatum", alt.anschaffungsdatum],
      ["anschaffungswert", alt.anschaffungswert],
      ["betriebsstunden", alt.betriebsstunden],
      ["notiz", alt.notiz],
    ];

    for (const [f, altWert] of vergleich) {
      const neuWert = werte[f];
      if (neuWert === undefined) continue; // leere Zelle: nichts tun
      const altText = altWert === null || altWert === undefined ? "" : String(altWert);
      const neuText = neuWert === null ? "" : String(neuWert);
      if (altText !== neuText) {
        aenderungen.push({ feld: f, alt: altText, neu: neuText });
      }
    }

    if (schlagworte) {
      const altWorte = alt.schlagworte.map((w) => w.name).sort().join(", ");
      const neuWorte = [...schlagworte].sort().join(", ");
      if (altWorte !== neuWorte) {
        aenderungen.push({ feld: "schlagworte", alt: altWorte, neu: neuWorte });
      }
    }

    return {
      ...basis,
      art: aenderungen.length ? "geaendert" : "unveraendert",
      aenderungen,
      werte,
      ...(schlagworte ? { schlagworte } : {}),
      geraetId: alt.id,
      rev: alt.rev,
    };
  });

  const zaehle = (art: ZeilenArt) => gepruefte.filter((z) => z.art === art).length;
  const fehler = zaehle("fehler");
  const konflikte = zaehle("konflikt");

  // Wer Standort oder Zustand in der Datei geändert hat, soll wissen, dass
  // das folgenlos bleibt — sonst wundert er sich hinterher.
  const hatZustandsspalten = zeilen.some(
    (z) => feld(z, SPALTEN.standort) || feld(z, SPALTEN.status),
  );
  if (hatZustandsspalten) {
    hinweise.push(
      "Standort und Zustand in der Datei werden NICHT übernommen — sie ergeben sich " +
        "ausschließlich aus Buchungen. Zum Umbuchen die Ausgabe- und Rücknahmefunktion nutzen.",
    );
  }
  if (neueSchlagworte.size) {
    hinweise.push(
      `${neueSchlagworte.size} neue Schlagworte werden angelegt: ${[...neueSchlagworte].join(", ")}`,
    );
  }

  return {
    zeilen: gepruefte,
    neu: zaehle("neu"),
    geaendert: zaehle("geaendert"),
    unveraendert: zaehle("unveraendert"),
    konflikte,
    fehler,
    neueSchlagworte: [...neueSchlagworte],
    // Fehler UND Konflikte verhindern den Import. Bei einem Konflikt hat
    // jemand anderes gearbeitet — das darf nicht stillschweigend verloren
    // gehen, nur weil eine Datei älter ist.
    schreibbar: fehler === 0 && konflikte === 0 && gepruefte.length > 0,
    hinweise,
  };
}
