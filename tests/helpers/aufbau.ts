/**
 * Vorbereitung für alle Tests.
 *
 * WICHTIG — die Falle aus PATIO, hier bewusst umgedreht:
 * Dort werden ohne DATABASE_URL rund 290 Datenbanktests STILL übersprungen,
 * und die Suite meldet trotzdem grün. Wer das nicht weiß, hält eine
 * ungeprüfte Änderung für geprüft.
 *
 * Hier bricht die Suite stattdessen LAUT ab, wenn die Datenbank fehlt.
 * Lieber ein roter Lauf mit klarer Ansage als ein grüner ohne Aussage.
 */

import "dotenv/config";
import { pruefeDb } from "../../src/db/client.js";

const { ok, fehler } = await pruefeDb();

if (!ok) {
  console.error(
    "\n" +
      "════════════════════════════════════════════════════════════════\n" +
      "  Die Testdatenbank ist nicht erreichbar — die Tests werden\n" +
      "  NICHT übersprungen, sondern brechen ab.\n" +
      "\n" +
      `  Fehler: ${fehler}\n` +
      `  DATABASE_URL: ${process.env.DATABASE_URL ?? "(nicht gesetzt)"}\n` +
      "\n" +
      "  Starten mit:\n" +
      "    wsl -d Ubuntu-24.04 -- docker start tracker-db\n" +
      "════════════════════════════════════════════════════════════════\n",
  );
  process.exit(1);
}
