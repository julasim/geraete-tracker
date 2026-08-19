/**
 * Pfadparameter sicher auslesen.
 *
 * Hono liefert `c.req.param()` als `string | undefined`. Statt das an
 * jeder Stelle mit einem "!" wegzuwinken, wird hier geprüft — und zwar
 * gleich richtig: Eine ID, die keine UUID ist, führt sonst erst in der
 * Datenbank zu einem Fehler (SQLSTATE 22P02). Das ist eine unbrauchbare
 * Anfrage, kein Serverproblem, und gehört mit 400 beantwortet.
 */

import type { Context } from "hono";
import { EingabeFehler } from "./fehler.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Eine UUID aus dem Pfad. Wirft 400, wenn sie fehlt oder unbrauchbar ist. */
export function pfadId(c: Context, name = "id"): string {
  const wert = c.req.param(name);
  if (!wert || !UUID.test(wert)) {
    throw new EingabeFehler(`Die ID im Pfad ist keine gültige Kennung.`);
  }
  return wert;
}

/** Ein beliebiger Pfadwert, z.B. ein Barcode. Wirft 400, wenn er fehlt. */
export function pfadText(c: Context, name: string, maxLaenge = 100): string {
  const wert = c.req.param(name);
  if (!wert || wert.length > maxLaenge) {
    throw new EingabeFehler(`Der Wert "${name}" im Pfad fehlt oder ist zu lang.`);
  }
  return decodeURIComponent(wert);
}
