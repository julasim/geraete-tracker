/**
 * Migrationen von Hand anwenden oder den Stand ansehen.
 *
 *   npm run db:migrate     alle offenen anwenden
 *   npm run db:status      nur zeigen, was offen ist
 */

import "dotenv/config";
import { migriere, migrationsStand } from "../src/db/migrate.js";
import { schliesseDb, warteAufDb } from "../src/db/client.js";

const nurStatus = process.argv.includes("--status");

try {
  await warteAufDb(3, 1000);

  if (nurStatus) {
    const stand = await migrationsStand();
    const offen = stand.filter((s) => !s.angewandt);
    console.log("");
    for (const s of stand) {
      const marke = s.angewandt ? "  ✓" : "  ·";
      const wann = s.zeitpunkt ? s.zeitpunkt.toISOString().slice(0, 16).replace("T", " ") : "offen";
      console.log(`${marke} ${s.name.padEnd(28)} ${wann}`);
    }
    console.log(
      `\n${stand.length} Migrationen, ${stand.length - offen.length} angewandt, ${offen.length} offen.\n`,
    );
  } else {
    const angewandt = await migriere();
    console.log(
      angewandt.length
        ? `\n${angewandt.length} Migration(en) angewandt:\n  ` + angewandt.join("\n  ") + "\n"
        : "\nNichts zu tun — die Datenbank ist auf aktuellem Stand.\n",
    );
  }
  await schliesseDb();
  process.exit(0);
} catch (fehler) {
  console.error("\nFehlgeschlagen:", fehler instanceof Error ? fehler.message : fehler, "\n");
  await schliesseDb();
  process.exit(1);
}
