/**
 * Barcodes vereinheitlichen und einordnen.
 *
 * Reine Fachlogik, ohne Datenbank — dadurch einzeln testbar.
 *
 * Der Anlass: Dieselbe Nummer erreicht die App auf drei Wegen, die
 * unterschiedlich aussehen können.
 *   * Kamera:            "10013"
 *   * Handeingabe:       " 10013 " oder "010013"
 *   * Hardware-Scanner:  "10013\r" oder "10013\t" (viele hängen ein
 *                        Abschlusszeichen an, das sich einstellen lässt)
 * Alle drei müssen dasselbe Gerät finden.
 */

/** Präfix der Lagerplatz-Etiketten. Die Datenbank erzwingt es zusätzlich. */
export const PLATZ_PRAEFIX = "P-";

export type CodeArt = "geraet" | "lagerplatz" | "unbrauchbar";

/**
 * Vereinheitlicht einen gelesenen oder getippten Code.
 *
 * Entfernt werden nur Leerzeichen und Steuerzeichen. Der Bindestrich BLEIBT:
 * er trägt beim Lagerplatz die Bedeutung ("P-0001"), und ohne ihn wäre der
 * Nummernkreis nicht mehr unterscheidbar.
 *
 * Wer "P0001" ohne Bindestrich tippt, meint eindeutig einen Platz — ein
 * Etikett kann nur eines von beidem sein, also wird er ergänzt.
 *
 * Führende Nullen bleiben erhalten, siehe suchVarianten().
 */
export function normalisiere(roh: string): string {
  const sauber = roh.replace(/\s/g, "").toUpperCase();
  if (/^P[0-9]/.test(sauber)) return PLATZ_PRAEFIX + sauber.slice(1);
  return sauber;
}

/**
 * Woran es sich beim Gescannten handelt.
 *
 * Die Unterscheidung ist nur möglich, weil die Nummernkreise getrennt sind:
 * Lagerplätze tragen "P-", Geräte reine Ziffern. Zwei CHECK-Constraints in
 * der Datenbank halten das aufrecht, auch bei Eingaben von Hand.
 */
export function codeArt(code: string): CodeArt {
  const sauber = normalisiere(code);
  if (!sauber) return "unbrauchbar";

  if (sauber.startsWith(PLATZ_PRAEFIX)) {
    const rest = sauber.slice(PLATZ_PRAEFIX.length);
    return /^[0-9A-Z]{1,20}$/.test(rest) ? "lagerplatz" : "unbrauchbar";
  }

  // Gerätenummern sind bei Julius fünfstellig numerisch. Andere Längen
  // trotzdem zulassen — Zukäufe könnten anders etikettiert sein.
  return /^[0-9]{1,32}$/.test(sauber) ? "geraet" : "unbrauchbar";
}

/**
 * Schreibweisen, unter denen dieselbe Nummer gesucht werden soll —
 * die vereinheitlichte zuerst.
 *
 * Warum führende Nullen nicht einfach abgeschnitten werden: Es ist nicht
 * auszuschließen, dass irgendwann ein Etikett "0042" und ein anderes "42"
 * existiert. Wer stumpf normalisiert, ordnet beide demselben Gerät zu und
 * bucht still das falsche. Deshalb wird die Eingabe unverändert gesucht und
 * die Null-bereinigte Fassung nur als ZUSÄTZLICHE Möglichkeit angeboten;
 * finden sich zwei verschiedene Geräte, muss der Benutzer entscheiden.
 */
export function suchVarianten(roh: string): string[] {
  const sauber = normalisiere(roh);
  if (!sauber) return [];

  const varianten = [sauber];

  if (/^0+[0-9]+$/.test(sauber)) {
    const ohneNullen = sauber.replace(/^0+/, "");
    if (ohneNullen && ohneNullen !== sauber) varianten.push(ohneNullen);
  }

  // Der umgekehrte Fall: getippt wurde "1234", das Etikett trägt "01234".
  // Nur für kurze rein numerische Eingaben, sonst wird die Liste unsinnig.
  if (/^[1-9][0-9]{0,9}$/.test(sauber)) {
    varianten.push("0" + sauber);
  }

  return varianten;
}

/**
 * Die nächste freie Gerätenummer in der Reihe.
 * Julius' Nummern laufen fünfstellig ab 10001.
 */
export function naechsteNummer(hoechste: string | null, stellen = 5): string {
  const zahl = hoechste ? Number(normalisiere(hoechste)) : 10_000;
  const naechste = (Number.isFinite(zahl) ? zahl : 10_000) + 1;
  return String(naechste).padStart(stellen, "0");
}

/** Die nächste freie Lagerplatz-Kennung, z.B. P-0001 → P-0002. */
export function naechsterPlatzCode(hoechster: string | null, stellen = 4): string {
  const zahl = hoechster ? Number(normalisiere(hoechster).slice(PLATZ_PRAEFIX.length)) : 0;
  const naechste = (Number.isFinite(zahl) ? zahl : 0) + 1;
  return PLATZ_PRAEFIX + String(naechste).padStart(stellen, "0");
}
