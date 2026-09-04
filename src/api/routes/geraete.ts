/**
 * Geräte und ihre Etiketten.
 *
 * Was hier NICHT passiert: den Zustand ändern. Standort, Lagerplatz und
 * Nutzer ergeben sich ausschließlich aus Buchungen (AP5). Gäbe es hier
 * einen Weg, den Standort nachträglich zu setzen, liefe er an der Historie
 * vorbei — und die Historie wäre nicht mehr die Wahrheit. `PATCH` kennt
 * `standort_id` und `lagerplatz_id` deshalb nicht.
 *
 * Die eine Ausnahme ist das ANLEGEN: Dort sind Ort und Platz der
 * Anfangswert, kein Übergang — es gibt keinen Vorzustand, von dem etwas
 * abweichen könnte. Begründung ausführlich in `data/geraete.ts`.
 */

import { Hono } from "hono";
import { z } from "zod";
import { angemeldet, darf, type AppEnv } from "../auth.js";
import {
  aendereGeraet,
  ergaenzeBarcode,
  findeGeraet,
  legeBarcodeStill,
  legeGeraetAn,
  listeAlleGeraete,
  listeBarcodes,
  listeGeraete,
  mustereAus,
  sucheGeraete,
} from "../../data/geraete.js";
import { zubehoerVon } from "../../data/pakete.js";
import { EingabeFehler } from "../fehler.js";
import { pfadId, pfadText } from "../pfad.js";

export const geraeteRouten = new Hono<AppEnv>();

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
 * Die komplette Liste. Ohne Paginierung, siehe data/geraete.ts —
 * bei rund 200 Geräten ist Filtern im Browser schneller als jeder
 * zusätzliche Serveraufruf.
 */
geraeteRouten.get("/geraete", async (c) => {
  const suche = c.req.query("q");
  if (suche) return c.json(await sucheGeraete(suche));
  const alle = c.req.query("alle") === "true";
  return c.json(alle ? await listeAlleGeraete() : await listeGeraete());
});

geraeteRouten.get("/geraete/:id", async (c) => c.json(await findeGeraet(pfadId(c))));

/**
 * Das Zubehör eines Geräts — die Löffel zum Bagger.
 *
 * Beim Buchen wird es zum Mitnehmen vorgeschlagen: Wer den Bagger ausgibt,
 * lädt die Löffel mit auf, und ohne diesen Vorschlag stünden sie im System
 * weiter im Lager.
 */
geraeteRouten.get("/geraete/:id/zubehoer", async (c) => {
  const id = pfadId(c);
  await findeGeraet(id); // 404 statt leerer Liste, wenn es das Gerät nicht gibt
  return c.json(await zubehoerVon(id));
});

geraeteRouten.get("/geraete/:id/barcodes", async (c) =>
  c.json(await listeBarcodes(pfadId(c))),
);

const neuSchema = z.object({
  bezeichnung: z.string().min(1).max(200),
  inventarnummer: z.string().max(40).nullish(),
  barcode: z.string().max(40).nullish(),
  hersteller: z.string().max(120).nullish(),
  modell: z.string().max(120).nullish(),
  seriennummer: z.string().max(120).nullish(),
  anschaffungsdatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  anschaffungswert: z.number().nonnegative().nullish(),
  notiz: z.string().max(4000).nullish(),
  betriebsstunden: z.number().nonnegative().nullish(),
  // Ort und Platz sind hier erlaubt, in `aenderungSchema` bewusst nicht:
  // Beim Anlegen ist das der Anfangswert, danach ergibt sich beides
  // ausschließlich aus Buchungen.
  standort_id: z.string().uuid().nullish(),
  lagerplatz_id: z.string().uuid().nullish(),
  schlagworte: z.array(z.string().uuid()).optional(),
});

geraeteRouten.post("/geraete", darf("geraete.pflegen"), async (c) => {
  const daten = await gelesen(c, neuSchema);
  const benutzer = angemeldet(c);
  return c.json(await legeGeraetAn(daten, benutzer.id), 201);
});

const aenderungSchema = z.object({
  bezeichnung: z.string().min(1).max(200).optional(),
  hersteller: z.string().max(120).nullish(),
  modell: z.string().max(120).nullish(),
  seriennummer: z.string().max(120).nullish(),
  anschaffungsdatum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  anschaffungswert: z.number().nonnegative().nullish(),
  notiz: z.string().max(4000).nullish(),
  schlagworte: z.array(z.string().uuid()).optional(),
  betriebsstunden: z.number().nonnegative().nullish(),
  // Zubehör: null löst die Zuordnung wieder.
  gehoert_zu_id: z.string().uuid().nullish(),
  // Pflicht: ohne die Fassung, auf der die Änderung beruht, ließe sich nicht
  // erkennen, ob inzwischen jemand anderes gespeichert hat.
  rev: z.number().int().positive(),
});

geraeteRouten.patch("/geraete/:id", darf("geraete.pflegen"), async (c) => {
  const daten = await gelesen(c, aenderungSchema);
  const benutzer = angemeldet(c);
  return c.json(await aendereGeraet(pfadId(c), daten, benutzer.id));
});

geraeteRouten.post("/geraete/:id/ausmustern", darf("geraete.ausmustern"), async (c) => {
  const benutzer = angemeldet(c);
  return c.json(await mustereAus(pfadId(c), benutzer.id));
});

geraeteRouten.post("/geraete/:id/barcodes", darf("geraete.pflegen"), async (c) => {
  const { barcode } = await gelesen(c, z.object({ barcode: z.string().min(1).max(40) }));
  const benutzer = angemeldet(c);
  const vergeben = await ergaenzeBarcode(pfadId(c), barcode, benutzer.id);
  return c.json({ barcode: vergeben }, 201);
});

geraeteRouten.delete("/geraete/:id/barcodes/:code", darf("geraete.pflegen"), async (c) => {
  await legeBarcodeStill(pfadId(c), pfadText(c, "code", 40));
  return c.json({ ok: true });
});
