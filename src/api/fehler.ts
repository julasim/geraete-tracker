/**
 * Fehlerarten, die die Fachschicht wirft und die zentrale Fehlerbehandlung
 * in server.ts in HTTP-Antworten übersetzt.
 *
 * Der Sinn: Die Fachschicht (src/data, src/domain) soll nichts von HTTP
 * wissen. Sie wirft "Gerät nicht gefunden", nicht "404". Die Übersetzung
 * steht an genau einer Stelle — nicht in jeder Route erneut.
 */

/** Angefragter Datensatz existiert nicht. → 404 */
export class NichtGefunden extends Error {
  constructor(was: string) {
    super(`${was} nicht gefunden.`);
    this.name = "NichtGefunden";
  }
}

/** Fachliche Regel verletzt, z.B. Ausgabe eines defekten Geräts. → 409 */
export class RegelFehler extends Error {
  constructor(
    text: string,
    readonly grund?: string,
  ) {
    super(text);
    this.name = "RegelFehler";
  }
}

/**
 * Jemand anderes hat inzwischen gespeichert. → 409 samt aktuellem Stand,
 * damit die Oberfläche zeigen kann, was sich geändert hat, statt den
 * Benutzer ins Leere laufen zu lassen.
 */
export class KonfliktFehler extends Error {
  constructor(
    text: string,
    readonly erwartet: number,
    readonly tatsaechlich: number,
    readonly aktuell?: unknown,
  ) {
    super(text);
    this.name = "KonfliktFehler";
  }
}

/** Eingabe unbrauchbar. → 400 */
export class EingabeFehler extends Error {
  constructor(
    text: string,
    readonly felder?: Record<string, string>,
  ) {
    super(text);
    this.name = "EingabeFehler";
  }
}

/** Nicht angemeldet oder Anmeldung nicht mehr gültig. → 401 */
export class NichtAngemeldet extends Error {
  constructor(text = "Nicht angemeldet.") {
    super(text);
    this.name = "NichtAngemeldet";
  }
}

/** Angemeldet, aber ohne das nötige Recht. → 403 */
export class KeinRecht extends Error {
  constructor(text = "Dafür fehlt die Berechtigung.") {
    super(text);
    this.name = "KeinRecht";
  }
}
