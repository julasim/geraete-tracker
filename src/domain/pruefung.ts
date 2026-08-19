/**
 * Fälligkeiten. Reine Rechnung, ohne Datenbank.
 *
 * Die Fälligkeit rechnet immer der SERVER. Käme sie vom Browser, könnte ein
 * Tippfehler eine sicherheitsrelevante Prüfung um Jahre verschieben.
 *
 * ALLES hier rechnet in UTC. Der Grund ist ein Fehler, der beim Bauen
 * auftrat und beinahe durchgegangen wäre: Ein mit lokalen Werten gebautes
 * Datum (`new Date(jahr, monat, tag)`) und eine Ausgabe über
 * `toISOString()` passen NICHT zusammen — in Österreich liegt lokale
 * Mitternacht ein bis zwei Stunden vor UTC-Mitternacht, das Datum fällt
 * dabei um einen Tag zurück. Aus dem 31.03. wurde so der 30.03.
 * Bei einer Prüffrist ist das kein Schönheitsfehler.
 */

export type Ampel = "ueberfaellig" | "faellig" | "bald" | "ok";

/** Ein reines Datum (ohne Uhrzeit) aus "JJJJ-MM-TT". */
export function ausIsoDatum(text: string): Date {
  const teile = text.slice(0, 10).split("-").map(Number);
  const [jahr, monat, tag] = teile;
  if (!jahr || !monat || !tag) throw new Error(`Unbrauchbares Datum: ${text}`);
  return new Date(Date.UTC(jahr, monat - 1, tag));
}

/** Wieder zurück nach "JJJJ-MM-TT". */
export function alsIsoDatum(datum: Date): string {
  return datum.toISOString().slice(0, 10);
}

/**
 * Prüfdatum plus Intervall.
 *
 * Fällt der Stichtag auf einen Tag, den es im Zielmonat nicht gibt
 * (31. August plus 6 Monate = 31. Februar), wird auf den letzten Tag des
 * Monats zurückgezogen. Sonst schöbe die Rechnung still in den März — die
 * Prüfung wäre einen Tag zu spät fällig, und niemand würde es je bemerken.
 */
export function naechsteFaelligkeit(geprueftAm: Date, intervallMonate: number): Date {
  const jahr = geprueftAm.getUTCFullYear();
  const monat = geprueftAm.getUTCMonth();
  const tag = geprueftAm.getUTCDate();

  const zielMonat = monat + intervallMonate;
  // Tag 0 des Folgemonats = letzter Tag des Zielmonats.
  const letzterImZiel = new Date(Date.UTC(jahr, zielMonat + 1, 0)).getUTCDate();

  return new Date(Date.UTC(jahr, zielMonat, Math.min(tag, letzterImZiel)));
}

/** Wie dringend ist es? */
export function ampel(faellig: Date, heute = new Date()): Ampel {
  const tage = tageBis(faellig, heute);
  if (tage < 0) return "ueberfaellig";
  if (tage <= 14) return "faellig";
  if (tage <= 60) return "bald";
  return "ok";
}

export function tageBis(ziel: Date, heute = new Date()): number {
  // Auf Tagesgrenzen normieren: Sonst hinge das Ergebnis an der Uhrzeit,
  // und dieselbe Prüfung wäre morgens "fällig" und abends "überfällig".
  const a = Date.UTC(ziel.getUTCFullYear(), ziel.getUTCMonth(), ziel.getUTCDate());
  const b = Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate());
  return Math.round((a - b) / 86_400_000);
}

export const AMPEL_TEXT: Record<Ampel, string> = {
  ueberfaellig: "überfällig",
  faellig: "fällig",
  bald: "bald fällig",
  ok: "in Ordnung",
};
