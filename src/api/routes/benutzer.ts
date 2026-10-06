/**
 * Benutzer und Rollen verwalten.
 *
 * Die Sperren gegen das eigene Aussperren sitzen bewusst NICHT hier, sondern
 * in `src/data/benutzer.ts` — sie sollen auch dann greifen, wenn jemand
 * später einen zweiten Weg zu denselben Daten baut.
 */

import { Hono } from "hono";
import { z } from "zod";
import { angemeldet, darf, hatRechtImKontext, type AppEnv } from "../auth.js";
import { pfadId } from "../pfad.js";
import { EingabeFehler } from "../fehler.js";
import {
  aendereBenutzer,
  legeBenutzerAn,
  listeBenutzerKurz,
  listeBenutzerVoll,
  setzePasswortZurueck,
} from "../../data/benutzer.js";
import {
  aendereRolle,
  legeRolleAn,
  listeRollen,
  loescheRolle,
} from "../../data/rollen.js";
import { RECHT_TEXT, rechteNachGruppe, RECHTE } from "../../domain/rechte.js";
import { letzteSicherung } from "../../data/sicherung.js";
import { logInfo } from "../../logger.js";
import { protokolliere } from "../../data/logbuch.js";

export const benutzerRouten = new Hono<AppEnv>();

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
 * Die Benutzerliste — in zwei Ausprägungen.
 *
 * Beim Ausgeben eines Geräts braucht JEDER die Namensliste, sonst lässt sich
 * nichts auf jemanden buchen. Ohne das Recht `benutzer.verwalten` liefert die
 * Route deshalb nur Kennung, Name und Zustand — nicht E-Mail, Rolle oder
 * Anmeldeverhalten.
 *
 * (Diese Route fehlte bis AP10 vollständig, während BuchenView sie bereits
 * aufrief — das Ausgeben lief dort in einen 404.)
 */
benutzerRouten.get("/benutzer", async (c) => {
  if (hatRechtImKontext(c, "benutzer.verwalten")) {
    return c.json(await listeBenutzerVoll());
  }
  return c.json(await listeBenutzerKurz());
});

const neuSchema = z.object({
  benutzername: z.string().min(3).max(40),
  anzeigename: z.string().min(1).max(120),
  email: z.string().max(200).nullish(),
  rolle: z.string().min(1).max(40),
});

benutzerRouten.post("/benutzer", darf("benutzer.verwalten"), async (c) => {
  const daten = await gelesen(c, neuSchema);
  const akteur = angemeldet(c);

  const { benutzer, einmalpasswort } = await legeBenutzerAn(daten);
  logInfo("Konto angelegt", { von: akteur.benutzername, neu: benutzer.benutzername });

  // Das Einmalpasswort wird GENAU HIER einmal ausgeliefert und nirgends
  // gespeichert. Wer es verliert, setzt es neu — das ist billiger als ein
  // Passwort, das irgendwo im Klartext herumliegt.
  await protokolliere({ benutzer_id: akteur.id, aktion: "angelegt", bereich: "benutzer", ziel_id: benutzer.id, ziel_text: benutzer.benutzername });
  return c.json({ benutzer, einmalpasswort }, 201);
});

benutzerRouten.patch("/benutzer/:id", darf("benutzer.verwalten"), async (c) => {
  const daten = await gelesen(
    c,
    z.object({
      anzeigename: z.string().min(1).max(120).optional(),
      email: z.string().max(200).nullish(),
      rolle: z.string().min(1).max(40).optional(),
      aktiv: z.boolean().optional(),
    }),
  );
  const akteur = angemeldet(c);
  const ergebnis = await aendereBenutzer(pfadId(c), daten, akteur.id);
  await protokolliere({ benutzer_id: akteur.id, aktion: "geaendert", bereich: "benutzer", ziel_id: pfadId(c), details: daten });
  return c.json(ergebnis);
});

benutzerRouten.post("/benutzer/:id/passwort", darf("benutzer.verwalten"), async (c) => {
  const akteur = angemeldet(c);
  const ergebnis = await setzePasswortZurueck(pfadId(c), akteur.id);
  logInfo("Passwort zurückgesetzt", { von: akteur.benutzername, konto: pfadId(c) });
  await protokolliere({ benutzer_id: akteur.id, aktion: "passwort_zurueckgesetzt", bereich: "benutzer", ziel_id: pfadId(c) });
  return c.json(ergebnis);
});

// ── Rollen ─────────────────────────────────────────────────────────────────

/**
 * Wann zuletzt gesichert wurde.
 *
 * Sitzt bei den Verwaltungsrouten, weil es dieselbe Person angeht: wer
 * Konten anlegt, kümmert sich auch darum, dass die Daten gesichert sind.
 * Das Recht ist `benutzer.verwalten` — ein Mitarbeiter auf der Baustelle
 * kann damit nichts anfangen und soll den Zustand der Anlage nicht sehen.
 */
benutzerRouten.get("/sicherung/stand", darf("benutzer.verwalten"), async (c) =>
  c.json(await letzteSicherung()),
);

/** Der Rechte-Katalog, gruppiert — die Vorlage für die Häkchenliste. */
benutzerRouten.get("/rechte", darf("benutzer.verwalten"), (c) =>
  c.json({
    rechte: RECHTE.map((r) => ({ id: r, ...RECHT_TEXT[r] })),
    gruppen: rechteNachGruppe(),
  }),
);

/**
 * Rollen darf jeder LESEN, der angemeldet ist — die Oberfläche braucht die
 * Namen, um sie neben Benutzern anzuzeigen. Ändern nur mit Recht.
 */
benutzerRouten.get("/rollen", async (c) => c.json(await listeRollen()));

benutzerRouten.post("/rollen", darf("benutzer.verwalten"), async (c) => {
  const daten = await gelesen(
    c,
    z.object({
      id: z.string().min(2).max(30),
      name: z.string().min(1).max(60),
      beschreibung: z.string().max(500).nullish(),
      rechte: z.array(z.string()).default([]),
    }),
  );
  const akteur = angemeldet(c);
  const rolle = await legeRolleAn(daten);
  await protokolliere({ benutzer_id: akteur.id, aktion: "angelegt", bereich: "rolle", ziel_text: daten.id });
  return c.json(rolle, 201);
});

benutzerRouten.patch("/rollen/:id", darf("benutzer.verwalten"), async (c) => {
  const daten = await gelesen(
    c,
    z.object({
      name: z.string().min(1).max(60).optional(),
      beschreibung: z.string().max(500).nullish(),
      rechte: z.array(z.string()).optional(),
    }),
  );
  // Kein pfadId(): Rollen-Kennungen sind Text, keine UUID.
  const id = c.req.param("id");
  if (!id) throw new EingabeFehler("Die Rollen-Kennung fehlt.");
  const akteur = angemeldet(c);
  const ergebnis = await aendereRolle(id, daten);
  await protokolliere({ benutzer_id: akteur.id, aktion: "geaendert", bereich: "rolle", ziel_text: id });
  return c.json(ergebnis);
});

benutzerRouten.delete("/rollen/:id", darf("benutzer.verwalten"), async (c) => {
  const id = c.req.param("id");
  if (!id) throw new EingabeFehler("Die Rollen-Kennung fehlt.");
  const akteur = angemeldet(c);
  await loescheRolle(id);
  await protokolliere({ benutzer_id: akteur.id, aktion: "geloescht", bereich: "rolle", ziel_text: id });
  return c.json({ ok: true });
});
