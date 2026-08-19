/**
 * Zugang zur Datenbank. postgres.js mit Tagged-Template-Syntax.
 *
 * Bewusst kein ORM: die Abfragen hier sind überschaubar, und die
 * Tagged Templates binden Parameter zwingend — SQL-Injection ist damit
 * strukturell ausgeschlossen, nicht bloß durch Disziplin vermieden.
 */

import postgres from "postgres";
import { DATABASE_URL } from "../config.js";
import { logError, logInfo } from "../logger.js";

let verbindung: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!verbindung) {
    verbindung = postgres(DATABASE_URL, {
      max: 10, // ~10 Benutzer, mehr Verbindungen brächten nichts
      idle_timeout: 30,
      connect_timeout: 10,
      // undefined als NULL statt als Fehler: erspart an jeder optionalen
      // Spalte ein "?? null"
      transform: { undefined: null },

      /**
       * DATE-Spalten kommen als TEXT zurück, nicht als Zeitpunkt-Objekt.
       *
       * Der Grund ist ein Fehler, der hier aufgetreten ist: Ein Prüfdatum
       * "2027-03-31" wurde als Date-Objekt gelesen (lokale Mitternacht),
       * beim Umwandeln nach JSON aber in UTC ausgegeben — und fiel dabei
       * auf den 30.03. zurück. Gespeichert stand das Richtige, angezeigt
       * wurde ein Tag zu früh.
       *
       * Ein Datum ohne Uhrzeit HAT keine Zeitzone. Es als Zeitpunkt zu
       * behandeln ist die eigentliche Ursache, nicht die Umrechnung.
       * TIMESTAMPTZ bleibt unberührt — dort ist der Zeitpunkt gewollt.
       */
      types: {
        datum: {
          to: 1082,
          from: [1082],
          serialize: (wert: unknown) => String(wert),
          parse: (wert: string) => wert,
        },
      },

      onnotice: () => {}, // "relation already exists" bei IF NOT EXISTS
    });
  }
  return verbindung;
}

/** Ist die Datenbank erreichbar und antwortet sie? */
export async function pruefeDb(): Promise<{ ok: boolean; fehler?: string }> {
  try {
    await db()`SELECT 1`;
    return { ok: true };
  } catch (fehler) {
    return { ok: false, fehler: fehler instanceof Error ? fehler.message : String(fehler) };
  }
}

/**
 * Wartet, bis die Datenbank erreichbar ist. Beim Start im Container kommt
 * Postgres oft ein paar Sekunden später hoch als die App — ohne Warten
 * stürbe die App beim ersten Startversuch.
 */
export async function warteAufDb(versuche = 15, abstandMs = 2000): Promise<void> {
  for (let i = 1; i <= versuche; i++) {
    const { ok, fehler } = await pruefeDb();
    if (ok) {
      if (i > 1) logInfo("Datenbank erreichbar", { nachVersuchen: i });
      return;
    }
    if (i === versuche) {
      logError("Datenbank nicht erreichbar", { versuche, fehler });
      throw new Error(`Datenbank nach ${versuche} Versuchen nicht erreichbar: ${fehler}`);
    }
    await new Promise((f) => setTimeout(f, abstandMs));
  }
}

export async function schliesseDb(): Promise<void> {
  if (verbindung) {
    await verbindung.end({ timeout: 5 });
    verbindung = null;
  }
}
