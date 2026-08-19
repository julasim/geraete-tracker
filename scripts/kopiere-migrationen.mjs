/**
 * tsc übersetzt nur .ts-Dateien — die .sql-Migrationen blieben sonst im
 * Quellordner zurück, und die gebaute App fände beim Start keine einzige.
 * Fällt in der Entwicklung nie auf, im Container sofort.
 */
import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/db/migrations", { recursive: true });
await cp("src/db/migrations", "dist/db/migrations", { recursive: true });
console.log("Migrationen nach dist/db/migrations kopiert");
