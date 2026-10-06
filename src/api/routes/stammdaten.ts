/**
 * Schlagworte, Standorte, Lagerplätze.
 *
 * Lesen darf jeder — die Frage "wo ist der Rüttler?" muss jeder beantworten
 * können. Ändern darf nur die Verwaltung.
 */

import { Hono } from "hono";
import { z } from "zod";
import { darf, type AppEnv } from "../auth.js";
import {
  aendereLagerplatz,
  aendereSchlagwort,
  aendereStandort,
  bestandAmLagerplatz,
  bestandAmStandort,
  findeLagerplatz,
  findeStandort,
  legeLagerplatzAn,
  legeSchlagwortAn,
  legeStandortAn,
  listeLagerplaetze,
  listeSchlagworte,
  listeStandorte,
  loescheSchlagwort,
} from "../../data/stammdaten.js";
import { EingabeFehler } from "../fehler.js";
import { pfadId } from "../pfad.js";
import { protokolliere } from "../../data/logbuch.js";
import { angemeldet } from "../auth.js";

export const stammdatenRouten = new Hono<AppEnv>();

/** Liest den Rumpf und wirft eine klare Meldung statt eines Zod-Rohtexts. */
async function gelesen<T>(c: { req: { json(): Promise<unknown> } }, schema: z.ZodType<T>): Promise<T> {
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

// ── Schlagworte ────────────────────────────────────────────────────────────

stammdatenRouten.get("/schlagworte", async (c) => c.json(await listeSchlagworte()));

const schlagwortSchema = z.object({
  name: z.string().min(1).max(60),
  farbe: z.string().max(30).nullish(),
});

stammdatenRouten.post("/schlagworte", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(c, schlagwortSchema);
  const ergebnis = await legeSchlagwortAn(daten);
  const akteur = angemeldet(c);
  await protokolliere({ benutzer_id: akteur.id, aktion: "angelegt", bereich: "schlagwort", ziel_id: ergebnis.id, ziel_text: ergebnis.name });
  return c.json(ergebnis, 201);
});

stammdatenRouten.patch("/schlagworte/:id", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(
    c,
    schlagwortSchema.partial().extend({ sort_order: z.number().int().optional() }),
  );
  const ergebnis = await aendereSchlagwort(pfadId(c), daten);
  const akteur = angemeldet(c);
  await protokolliere({ benutzer_id: akteur.id, aktion: "geaendert", bereich: "schlagwort", ziel_id: ergebnis.id, ziel_text: ergebnis.name });
  return c.json(ergebnis);
});

stammdatenRouten.delete("/schlagworte/:id", darf("stammdaten.pflegen"), async (c) => {
  const id = pfadId(c);
  await loescheSchlagwort(id);
  const akteur = angemeldet(c);
  await protokolliere({ benutzer_id: akteur.id, aktion: "geloescht", bereich: "schlagwort", ziel_id: id });
  return c.json({ ok: true });
});

// ── Standorte ──────────────────────────────────────────────────────────────

stammdatenRouten.get("/standorte", async (c) => {
  const nurAktive = c.req.query("aktiv") === "true";
  return c.json(await listeStandorte(nurAktive));
});

stammdatenRouten.get("/standorte/:id", async (c) => c.json(await findeStandort(pfadId(c))));

stammdatenRouten.get("/standorte/:id/bestand", async (c) => {
  const id = pfadId(c);
  const standort = await findeStandort(id);
  return c.json({ standort, geraete: await bestandAmStandort(id) });
});

const standortSchema = z.object({
  name: z.string().min(1).max(120),
  typ: z.enum(["lager", "baustelle", "werkstatt", "extern"]),
  adresse: z.string().max(300).nullish(),
  notiz: z.string().max(2000).nullish(),
});

stammdatenRouten.post("/standorte", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(c, standortSchema);
  const ergebnis = await legeStandortAn(daten);
  const akteur = angemeldet(c);
  await protokolliere({ benutzer_id: akteur.id, aktion: "angelegt", bereich: "standort", ziel_id: ergebnis.id, ziel_text: ergebnis.name });
  return c.json(ergebnis, 201);
});

stammdatenRouten.patch("/standorte/:id", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(c, standortSchema.partial().extend({ aktiv: z.boolean().optional() }));
  const ergebnis = await aendereStandort(pfadId(c), daten);
  const akteur = angemeldet(c);
  await protokolliere({ benutzer_id: akteur.id, aktion: "geaendert", bereich: "standort", ziel_id: ergebnis.id, ziel_text: ergebnis.name });
  return c.json(ergebnis);
});

// ── Lagerplätze ────────────────────────────────────────────────────────────

stammdatenRouten.get("/lagerplaetze", async (c) =>
  c.json(await listeLagerplaetze(c.req.query("standort"))),
);

stammdatenRouten.get("/lagerplaetze/:id", async (c) =>
  c.json(await findeLagerplatz(pfadId(c))),
);

stammdatenRouten.get("/lagerplaetze/:id/bestand", async (c) => {
  const id = pfadId(c);
  const platz = await findeLagerplatz(id);
  return c.json({ lagerplatz: platz, geraete: await bestandAmLagerplatz(id) });
});

const lagerplatzSchema = z.object({
  standort_id: z.string().uuid(),
  bezeichnung: z.string().min(1).max(120),
  typ: z.enum(["regal", "fach", "container", "freiflaeche"]).optional(),
  // Ohne Code wird der nächste freie vergeben — niemand muss sich Nummern merken.
  barcode: z.string().max(40).nullish(),
  notiz: z.string().max(2000).nullish(),
});

stammdatenRouten.post("/lagerplaetze", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(c, lagerplatzSchema);
  const ergebnis = await legeLagerplatzAn(daten);
  const akteur = angemeldet(c);
  await protokolliere({ benutzer_id: akteur.id, aktion: "angelegt", bereich: "lagerplatz", ziel_id: ergebnis.id, ziel_text: ergebnis.bezeichnung });
  return c.json(ergebnis, 201);
});

stammdatenRouten.patch("/lagerplaetze/:id", darf("stammdaten.pflegen"), async (c) => {
  const daten = await gelesen(
    c,
    z.object({
      bezeichnung: z.string().min(1).max(120).optional(),
      typ: z.enum(["regal", "fach", "container", "freiflaeche"]).optional(),
      notiz: z.string().max(2000).nullish(),
      aktiv: z.boolean().optional(),
    }),
  );
  const ergebnis = await aendereLagerplatz(pfadId(c), daten);
  const akteur = angemeldet(c);
  await protokolliere({ benutzer_id: akteur.id, aktion: "geaendert", bereich: "lagerplatz", ziel_id: ergebnis.id, ziel_text: ergebnis.bezeichnung });
  return c.json(ergebnis);
});
