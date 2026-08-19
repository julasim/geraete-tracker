/**
 * Etikettenbögen als PDF.
 *
 * Der Ausdruck ist jederzeit wiederholbar: Geht ein Bogen verloren, bevor
 * er geklebt wurde, sind die Nummern zwar vergeben, aber ein neuer Ausdruck
 * ist ein Klick. Deshalb nimmt die Route eine Liste von Geräte-IDs und
 * nicht etwa "die zuletzt angelegten".
 */

import { Hono } from "hono";
import { z } from "zod";
import { darf, type AppEnv } from "../auth.js";
import { EingabeFehler } from "../fehler.js";
import { db } from "../../db/client.js";
import { FIRMENNAME, ETIKETT_FORMAT } from "../../config.js";
import { baueBogen, baueTestbogen, FORMATE } from "../../etiketten/bogen.js";

export const etikettenRouten = new Hono<AppEnv>();

/** Die verfügbaren Bogenformate — für die Auswahl in der Oberfläche. */
etikettenRouten.get("/etiketten/formate", darf("etiketten.drucken"), (c) =>
  c.json({
    formate: Object.entries(FORMATE).map(([schluessel, f]) => ({
      schluessel,
      name: f.name,
      proBogen: f.spalten * f.reihen,
    })),
    voreinstellung: ETIKETT_FORMAT,
    firmenname: FIRMENNAME,
  }),
);

/**
 * Testbogen. Vier Etiketten zum Ausprobieren — drucken, kleben, scannen,
 * und erst danach den großen Lauf.
 */
etikettenRouten.get("/etiketten/testbogen", darf("etiketten.drucken"), async (c) => {
  const format = c.req.query("format") ?? ETIKETT_FORMAT;
  const pdf = await baueTestbogen({
    format: format as keyof typeof FORMATE,
    firmenname: FIRMENNAME,
  });

  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", 'inline; filename="testbogen.pdf"');
  c.header("Cache-Control", "no-store");
  // Hono erwartet Standard-Bytes, keinen Node-eigenen Puffer.
  return c.body(new Uint8Array(pdf));
});

const anfrageSchema = z.object({
  geraete: z.array(z.string().uuid()).min(1).max(500),
  format: z.string().max(20).optional(),
  /** Für angebrochene Bögen: bei welchem Etikett begonnen wird (0-basiert). */
  startPosition: z.number().int().min(0).max(100).optional(),
});

etikettenRouten.post("/etiketten", darf("etiketten.drucken"), async (c) => {
  const roh = await c.req.json().catch(() => null);
  const gelesen = anfrageSchema.safeParse(roh);
  if (!gelesen.success) {
    throw new EingabeFehler("Es wurde keine gültige Geräteliste gesendet.");
  }
  const { geraete: ids, format, startPosition } = gelesen.data;

  const zeilen = await db()<{ inventarnummer: string; bezeichnung: string }[]>`
    SELECT inventarnummer, bezeichnung FROM geraete
     WHERE id = ANY(${ids}) AND inventarnummer IS NOT NULL
     ORDER BY inventarnummer`;

  if (!zeilen.length) {
    throw new EingabeFehler("Keines der gewählten Geräte hat eine Inventarnummer.");
  }

  const pdf = await baueBogen(
    zeilen.map((z) => ({ code: z.inventarnummer, bezeichnung: z.bezeichnung })),
    {
      format: (format ?? ETIKETT_FORMAT) as keyof typeof FORMATE,
      firmenname: FIRMENNAME,
      ...(startPosition !== undefined ? { startPosition } : {}),
    },
  );

  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", 'inline; filename="etiketten.pdf"');
  c.header("Cache-Control", "no-store");
  // Hono erwartet Standard-Bytes, keinen Node-eigenen Puffer.
  return c.body(new Uint8Array(pdf));
});
