/**
 * Prüfungen und Schäden.
 *
 * Melden darf jeder: Wer den Schaden bemerkt, soll ihn eintragen können,
 * sonst wird er nicht eingetragen. Prüfungen und das Erledigen von Schäden
 * bleiben bei der Verwaltung.
 */

import { Hono } from "hono";
import { z } from "zod";
import { angemeldet, darf, type AppEnv } from "../auth.js";
import { pfadId } from "../pfad.js";
import { EingabeFehler } from "../fehler.js";
import { findeGeraet } from "../../data/geraete.js";
import {
  alleFaelligen,
  legePruefartAn,
  listePruefarten,
  pruefungenFuerGeraet,
  tragePruefungEin,
} from "../../data/pruefungen.js";
import {
  aendereSchaden,
  listeSchaeden,
  meldeSchaden,
  schaedenFuerGeraet,
} from "../../data/schaeden.js";
import { ampel } from "../../domain/pruefung.js";

export const pflegeRouten = new Hono<AppEnv>();

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

// ── Prüfarten ──────────────────────────────────────────────────────────────

pflegeRouten.get("/pruefarten", async (c) => c.json(await listePruefarten()));

pflegeRouten.post("/pruefarten", darf("pruefungen.eintragen"), async (c) => {
  const daten = await gelesen(
    c,
    z.object({
      name: z.string().min(1).max(80),
      intervall_monate: z.number().int().min(1).max(600),
      notiz: z.string().max(2000).nullish(),
    }),
  );
  return c.json(await legePruefartAn(daten), 201);
});

// ── Prüfungen ──────────────────────────────────────────────────────────────

pflegeRouten.get("/geraete/:id/pruefungen", async (c) => {
  const id = pfadId(c);
  await findeGeraet(id);
  return c.json(await pruefungenFuerGeraet(id));
});

pflegeRouten.post("/geraete/:id/pruefungen", darf("pruefungen.eintragen"), async (c) => {
  const id = pfadId(c);
  await findeGeraet(id);
  const benutzer = angemeldet(c);

  const daten = await gelesen(
    c,
    z.object({
      pruefart_id: z.string().uuid(),
      geprueft_am: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      ergebnis: z.enum(["bestanden", "maengel", "durchgefallen"]),
      pruefer: z.string().max(120).nullish(),
      notiz: z.string().max(2000).nullish(),
    }),
  );

  return c.json(await tragePruefungEin({ ...daten, geraet_id: id }, benutzer.id), 201);
});

/** Die Ampelliste: was ist überfällig, was wird bald fällig. */
pflegeRouten.get("/pruefungen/faellig", async (c) => {
  const alle = await alleFaelligen();
  const mitAmpel = alle
    .map((p) => ({ ...p, ampel: ampel(new Date(p.naechste_faellig)) }))
    .filter((p) => p.ampel !== "ok")
    .sort((a, b) => a.tage_bis_faellig - b.tage_bis_faellig);
  return c.json(mitAmpel);
});

// ── Schäden ────────────────────────────────────────────────────────────────

pflegeRouten.get("/schaeden", async (c) =>
  c.json(await listeSchaeden(c.req.query("offen") === "true")),
);

pflegeRouten.get("/geraete/:id/schaeden", async (c) => {
  const id = pfadId(c);
  await findeGeraet(id);
  return c.json(await schaedenFuerGeraet(id));
});

pflegeRouten.post("/geraete/:id/schaeden", darf("schaeden.melden"), async (c) => {
  const id = pfadId(c);
  await findeGeraet(id);
  const benutzer = angemeldet(c);

  const daten = await gelesen(
    c,
    z.object({
      beschreibung: z.string().min(3).max(4000),
      schwere: z.enum(["gering", "mittel", "ausfall"]),
      buchung_id: z.string().uuid().nullish(),
    }),
  );

  const schaden = await meldeSchaden({ ...daten, geraet_id: id }, benutzer.id);
  // Das Gerät kommt mit: Bei "ausfall" hat sich sein Zustand gerade geändert,
  // und die Oberfläche soll das sofort zeigen können.
  return c.json({ schaden, geraet: await findeGeraet(id) }, 201);
});

pflegeRouten.patch("/schaeden/:id", darf("schaeden.bearbeiten"), async (c) => {
  const id = pfadId(c);
  const benutzer = angemeldet(c);
  const daten = await gelesen(
    c,
    z.object({
      status: z.enum(["offen", "in_reparatur", "erledigt"]).optional(),
      erledigt_notiz: z.string().max(2000).nullish(),
    }),
  );

  const schaden = await aendereSchaden(id, daten, benutzer.id);
  return c.json({ schaden, geraet: await findeGeraet(schaden.geraet_id) });
});
