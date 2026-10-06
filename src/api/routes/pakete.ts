/**
 * Pakete — benannte Zusammenstellungen für die Sammelbuchung.
 *
 * Lesen darf jeder: Wer ein Paket ausgeben will, muss sehen, was drin ist.
 * Zusammenstellen darf die Verwaltung (`stammdaten.pflegen`, dasselbe Recht
 * wie für Standorte und Schlagworte) — ein Paket ist Stammdatenpflege, kein
 * Vorgang.
 */

import { Hono } from "hono";
import { z } from "zod";
import { darf, angemeldet, type AppEnv } from "../auth.js";
import {
  aenderePaket,
  findePaket,
  legePaketAn,
  listePakete,
  loeschePaket,
  paketGeraete,
} from "../../data/pakete.js";
import { EingabeFehler } from "../fehler.js";
import { pfadId } from "../pfad.js";
import { protokolliere } from "../../data/logbuch.js";

export const paketRouten = new Hono<AppEnv>();

/** Liest den Rumpf und wirft eine klare Meldung statt eines Zod-Rohtexts. */
async function gelesen<T>(
  c: { req: { json(): Promise<unknown> } },
  schema: z.ZodType<T>,
): Promise<T> {
  const roh = await c.req.json().catch(() => null);
  const ergebnis = schema.safeParse(roh);
  if (!ergebnis.success) {
    const felder: Record<string, string> = {};
    for (const problem of ergebnis.error.issues) {
      felder[problem.path.join(".") || "_"] = problem.message;
    }
    throw new EingabeFehler("Die Eingabe ist unvollständig oder fehlerhaft.", felder);
  }
  return ergebnis.data;
}

/**
 * Die Obergrenze von 200 Geräten je Paket ist eine Notbremse, keine
 * fachliche Grenze: Der ganze Bestand umfasst rund 200 Maschinen, ein Paket
 * mit allen wäre bereits ein Bedienfehler.
 */
const paketSchema = z.object({
  name: z.string().min(1).max(120),
  notiz: z.string().max(2000).nullish(),
  geraet_ids: z.array(z.string().uuid()).max(200).optional(),
});

paketRouten.get("/pakete", async (c) => c.json(await listePakete()));

paketRouten.get("/pakete/:id", async (c) => c.json(await findePaket(pfadId(c))));

paketRouten.get("/pakete/:id/geraete", async (c) => {
  const id = pfadId(c);
  await findePaket(id); // 404 statt leerer Liste, wenn es das Paket nicht gibt
  return c.json(await paketGeraete(id));
});

paketRouten.post("/pakete", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(c, paketSchema);
  const ergebnis = await legePaketAn(daten, angemeldet(c).id);
  await protokolliere({ benutzer_id: angemeldet(c).id, aktion: "angelegt", bereich: "paket", ziel_id: ergebnis.id, ziel_text: ergebnis.name });
  return c.json(ergebnis, 201);
});

paketRouten.patch("/pakete/:id", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(c, paketSchema.partial().extend({ aktiv: z.boolean().optional() }));
  const ergebnis = await aenderePaket(pfadId(c), daten, angemeldet(c).id);
  await protokolliere({ benutzer_id: angemeldet(c).id, aktion: "geaendert", bereich: "paket", ziel_id: ergebnis.id, ziel_text: ergebnis.name });
  return c.json(ergebnis);
});

/**
 * Ein Paket darf wirklich gelöscht werden — anders als ein Standort, dessen
 * Name in jeder Buchung steht. Ein Paket hält keinen Bestand und taucht in
 * keiner Historie auf; die Zuordnungen gehen per CASCADE mit.
 */
paketRouten.delete("/pakete/:id", darf("stammdaten.pflegen"), async (c) => {
  const akteur = angemeldet(c);
  await loeschePaket(pfadId(c));
  await protokolliere({ benutzer_id: akteur.id, aktion: "geloescht", bereich: "paket", ziel_id: pfadId(c) });
  return c.body(null, 204);
});
