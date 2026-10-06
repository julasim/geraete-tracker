/**
 * Logbuch — Abfrage des Protokolls aller Vorgänge.
 *
 * Nur lesend, nur mit benutzer.verwalten. Wer darf, sieht alles.
 */

import { Hono } from "hono";
import { darf, type AppEnv } from "../auth.js";
import { leseLogbuch, logbuchBereiche } from "../../data/logbuch.js";

export const logbuchRouten = new Hono<AppEnv>();

logbuchRouten.get("/logbuch", darf("benutzer.verwalten"), async (c) => {
  const bereich = c.req.query("bereich") || undefined;
  const benutzer_id = c.req.query("benutzer_id") || undefined;
  const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const ergebnis = await leseLogbuch({ bereich, benutzer_id, limit, offset });
  return c.json(ergebnis);
});

logbuchRouten.get("/logbuch/bereiche", darf("benutzer.verwalten"), async (c) => {
  return c.json(await logbuchBereiche());
});
