/**
 * Start der Anwendung.
 *
 * Reihenfolge mit Bedacht: erst Konfiguration prüfen (bricht bei fehlenden
 * Pflichtwerten sofort ab), dann auf die Datenbank warten (im Container
 * kommt Postgres oft ein paar Sekunden später hoch), dann migrieren, dann
 * erst den Port öffnen. Wer vorher anfragt, bekommt keine halbfertige App.
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { API_PORT, DB_AUTO_MIGRATE, PRODUKTION } from "./config.js";
import { schliesseDb, warteAufDb } from "./db/client.js";
import { migriere } from "./db/migrate.js";
import { logError, logInfo } from "./logger.js";
import { app } from "./api/server.js";

async function starte(): Promise<void> {
  logInfo("Geräte-Tracker startet", { produktion: PRODUKTION, port: API_PORT });

  await warteAufDb();

  if (DB_AUTO_MIGRATE) {
    const angewandt = await migriere();
    if (angewandt.length) logInfo("Migrationen angewandt", { anzahl: angewandt.length });
  } else {
    logInfo("Automatische Migration ist abgeschaltet (DB_AUTO_MIGRATE=false)");
  }

  const server = serve({ fetch: app.fetch, port: API_PORT }, (info) => {
    logInfo("Bereit", { adresse: `http://localhost:${info.port}` });
  });

  // Ohne diesen Zweig endet ein belegter Port in einem rohen Stacktrace, in
  // dem die eigentliche Ursache untergeht. Beim Entwickeln passiert genau das
  // ständig — ein alter Prozess läuft noch, der neue stirbt still, und man
  // testet minutenlang gegen den alten Stand. (Genau so passiert.)
  server.on("error", (fehler: NodeJS.ErrnoException) => {
    if (fehler.code === "EADDRINUSE") {
      logError(`Port ${API_PORT} ist belegt — läuft die Anwendung schon?`, {
        hinweis:
          "Laufenden Prozess beenden oder API_PORT in der .env ändern. " +
          'Unter Windows: Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'"',
      });
    } else {
      logError("Der Server konnte nicht starten", { fehler });
    }
    process.exit(1);
  });

  // Sauber beenden: laufende Anfragen zu Ende bringen, Datenbank schließen.
  // Ohne das bleiben beim Container-Neustart Verbindungen hängen.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      logInfo("Beende", { signal });
      server.close(async () => {
        await schliesseDb();
        process.exit(0);
      });
      // Notbremse, falls eine Anfrage hängt
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

starte().catch(async (fehler) => {
  logError("Start fehlgeschlagen", { fehler });
  await schliesseDb();
  process.exit(1);
});
