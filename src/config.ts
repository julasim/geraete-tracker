/**
 * Alle einstellbaren Werte an einer Stelle, einmal gelesen, als Konstanten
 * exportiert. Nirgends sonst im Code steht ein process.env-Zugriff.
 *
 * Fehlt etwas Wichtiges, bricht der Start hier ab — mit einer Meldung, die
 * sagt was fehlt, statt drei Schichten tiefer als Folgefehler aufzuschlagen.
 */

const istProduktion = process.env.NODE_ENV === "production";

function pflicht(name: string): string {
  const wert = process.env[name];
  if (!wert || wert.trim() === "") {
    throw new Error(
      `Konfiguration unvollständig: ${name} fehlt. ` +
        `Bitte in der .env setzen (Vorlage: .env.example).`,
    );
  }
  return wert.trim();
}

function zahl(name: string, standard: number): number {
  const roh = process.env[name];
  if (roh === undefined || roh.trim() === "") return standard;
  const wert = Number(roh);
  if (!Number.isFinite(wert)) {
    throw new Error(`Konfiguration fehlerhaft: ${name}="${roh}" ist keine Zahl.`);
  }
  return wert;
}

function schalter(name: string, standard: boolean): boolean {
  const roh = process.env[name]?.trim().toLowerCase();
  if (roh === undefined || roh === "") return standard;
  return roh === "true" || roh === "1" || roh === "ja";
}

// ── Betrieb ────────────────────────────────────────────────────────────────
export const PRODUKTION = istProduktion;
export const API_PORT = zahl("API_PORT", 3000);
export const LOG_LEVEL = process.env.LOG_LEVEL?.trim() || "info";

// ── Datenbank ──────────────────────────────────────────────────────────────
export const DATABASE_URL = pflicht("DATABASE_URL");
export const DB_AUTO_MIGRATE = schalter("DB_AUTO_MIGRATE", true);

// ── Anmeldung ──────────────────────────────────────────────────────────────
export const JWT_SECRET = pflicht("JWT_SECRET");

// Ein kurzes Geheimnis lässt sich durchprobieren. In der Entwicklung nur ein
// Hinweis, in Produktion ein harter Abbruch — dort ist der Schaden real.
const MIN_SECRET_LAENGE = 32;
if (JWT_SECRET.length < MIN_SECRET_LAENGE) {
  const meldung =
    `JWT_SECRET ist nur ${JWT_SECRET.length} Zeichen lang, mindestens ` +
    `${MIN_SECRET_LAENGE} sind nötig. Erzeugen mit: ` +
    `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`;
  if (istProduktion) throw new Error(meldung);
  console.warn(`[WARNUNG] ${meldung}`);
}

export const COOKIE_SECURE = schalter("COOKIE_SECURE", istProduktion);
export const SESSION_TAGE = zahl("SESSION_TAGE", 30);

// ── Passwortschutz ─────────────────────────────────────────────────────────
export const PASSWORT_MIN_LAENGE = zahl("PASSWORT_MIN_LAENGE", 12);
export const LEAK_PRUEFUNG = schalter("LEAK_PRUEFUNG", true);
export const SPERRE_NACH_VERSUCHEN = zahl("SPERRE_NACH_VERSUCHEN", 10);
export const SPERRE_MINUTEN = zahl("SPERRE_MINUTEN", 15);

// ── Etiketten ──────────────────────────────────────────────────────────────
// Steht auf jedem gedruckten Etikett. Hilft, wenn Geräte auf gemeinsamen
// Baustellen mit Fremdfirmen stehen — dann ist auf einen Blick klar, wem
// es gehört. Leer lassen unterdrückt die Zeile.
export const FIRMENNAME = process.env.FIRMENNAME?.trim() ?? "SIMA INFRA Construction GmbH";
export const ETIKETT_FORMAT = process.env.ETIKETT_FORMAT?.trim() || "70x37";

// ── Dateien ────────────────────────────────────────────────────────────────
export const DATA_PATH = process.env.DATA_PATH?.trim() || "./daten";
export const UPLOAD_MAX_BYTES = zahl("UPLOAD_MAX_MB", 100) * 1024 * 1024;
