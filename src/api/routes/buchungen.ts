/**
 * Buchen: ausgeben, zurücknehmen, umbuchen — und berichtigen.
 *
 * Buchen darf JEDER angemeldete Benutzer. Das ist Absicht: Wer ein Gerät
 * mitnimmt, soll es auch selbst buchen können, sonst wird es nicht gebucht.
 * Nachvollziehbar bleibt es trotzdem, weil jede Zeile festhält, wer sie
 * erfasst hat.
 *
 * Berichtigen darf nur die Verwaltung — und nur mit Begründung.
 */

import { Hono } from "hono";
import { z } from "zod";
import { angemeldet, darf, type AppEnv } from "../auth.js";
import { pfadId } from "../pfad.js";
import { EingabeFehler } from "../fehler.js";
import { buche, bucheMehrere, historie, korrigiere, offeneAusgaben } from "../../data/buchungen.js";
import { findeGeraet } from "../../data/geraete.js";

export const buchungsRouten = new Hono<AppEnv>();

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

const buchungsSchema = z.object({
  geraet_id: z.string().uuid(),
  art: z.enum(["ausgabe", "ruecknahme", "umbuchung"]),
  nach_standort_id: z.string().uuid().nullish(),
  nach_lagerplatz_id: z.string().uuid().nullish(),
  empfaenger_id: z.string().uuid().nullish(),
  // Für Subunternehmer ohne Zugang zur App.
  empfaenger_freitext: z.string().max(120).nullish(),
  geplante_rueckgabe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  notiz: z.string().max(2000).nullish(),
  ausfall: z.boolean().optional(),
});

/**
 * Sammelbuchung: dieselben Angaben, nur für mehrere Geräte.
 *
 * Die Obergrenze von 100 ist keine fachliche, sondern eine Notbremse: Ein
 * Transporter fasst keine hundert Maschinen, und eine versehentlich
 * abgeschickte Riesenliste soll nicht minutenlang eine Transaktion halten,
 * die alle anderen Buchungen blockiert.
 */
const sammelSchema = buchungsSchema
  .omit({ geraet_id: true })
  .extend({ geraet_ids: z.array(z.string().uuid()).min(1).max(100) });

buchungsRouten.post("/buchungen/sammel", darf("buchungen.erfassen"), async (c) => {
  const { geraet_ids, ...daten } = await gelesen(c, sammelSchema);
  const benutzer = angemeldet(c);

  const buchungen = await bucheMehrere(geraet_ids, daten, benutzer.id);
  // Die Geräte kommen mit zurück — wie bei der Einzelbuchung zeigt die
  // Oberfläche danach den neuen Zustand ohne zweiten Aufruf.
  const geraete = await Promise.all(buchungen.map((b) => findeGeraet(b.geraet_id)));
  return c.json({ buchungen, geraete }, 201);
});

buchungsRouten.post("/buchungen", darf("buchungen.erfassen"), async (c) => {
  const daten = await gelesen(c, buchungsSchema);
  const benutzer = angemeldet(c);

  const buchung = await buche(daten, benutzer.id);
  // Das Gerät kommt mit zurück: Die Oberfläche zeigt danach die
  // Bestätigungsseite mit dem neuen Zustand, ohne zweiten Aufruf.
  return c.json({ buchung, geraet: await findeGeraet(daten.geraet_id) }, 201);
});

const korrekturSchema = z.object({
  geraet_id: z.string().uuid(),
  neuer_status: z.enum(["verfuegbar", "ausgegeben", "wartung", "defekt"]),
  nach_standort_id: z.string().uuid().nullish(),
  empfaenger_id: z.string().uuid().nullish(),
  storniert_durch: z.string().uuid().nullish(),
  // Pflicht. Eine Berichtigung ohne Begründung ist in einem halben Jahr
  // nicht mehr nachvollziehbar.
  begruendung: z.string().min(3).max(2000),
});

buchungsRouten.post("/buchungen/korrektur", darf("buchungen.korrigieren"), async (c) => {
  const daten = await gelesen(c, korrekturSchema);
  const benutzer = angemeldet(c);
  const buchung = await korrigiere(daten, benutzer.id);
  return c.json({ buchung, geraet: await findeGeraet(daten.geraet_id) }, 201);
});

/** Alles, was gerade draußen ist — am längsten Ausgegebenes zuerst. */
buchungsRouten.get("/buchungen/offen", async (c) => c.json(await offeneAusgaben()));

buchungsRouten.get("/geraete/:id/historie", async (c) => {
  const id = pfadId(c);
  await findeGeraet(id); // 404 statt leerer Liste, wenn es das Gerät nicht gibt
  return c.json(await historie(id));
});
