/**
 * Fotos und Dokumente hochladen, ansehen, löschen.
 *
 * Hochladen darf JEDER angemeldete Benutzer — ein Zustandsfoto bei der
 * Rücknahme ist genau dann wertvoll, wenn es der macht, der das Gerät
 * zurückbringt. Löschen darf nur die Verwaltung.
 */

import { Hono } from "hono";
import { angemeldet, darf, type AppEnv } from "../auth.js";
import { pfadId } from "../pfad.js";
import { EingabeFehler } from "../fehler.js";
import { findeGeraet } from "../../data/geraete.js";
import {
  entferneDatei,
  findeDatei,
  listeDateien,
  setzeTitelbild,
  speichereDatei,
} from "../../data/dateien.js";
import { leseDatei, leseThumbnail, nimmDateiAn } from "../upload.js";
import { protokolliere } from "../../data/logbuch.js";

export const dateiRouten = new Hono<AppEnv>();

dateiRouten.get("/geraete/:id/dateien", async (c) => {
  const id = pfadId(c);
  await findeGeraet(id);
  return c.json(await listeDateien(id));
});

dateiRouten.post("/geraete/:id/dateien", darf("dateien.hochladen"), async (c) => {
  const geraetId = pfadId(c);
  await findeGeraet(geraetId);
  const benutzer = angemeldet(c);

  const formular = await c.req.formData().catch(() => null);
  if (!formular) throw new EingabeFehler("Die Anfrage enthält kein Formular.");

  const datei = formular.get("datei");
  if (!(datei instanceof File)) {
    throw new EingabeFehler('Es wurde keine Datei gesendet (Feld "datei").');
  }

  // Ablage je Gerät in einem eigenen Ordner: hält den Datenordner
  // überschaubar und macht ein Aufräumen von Hand nachvollziehbar.
  const gespeichert = await nimmDateiAn(datei, `geraete/${geraetId}`);

  const schadenId = formular.get("schaden_id");
  const buchungId = formular.get("buchung_id");
  const titel = formular.get("titel");

  const ergebnis = await speichereDatei({
    geraet_id: geraetId,
    schaden_id: typeof schadenId === "string" && schadenId ? schadenId : null,
    buchung_id: typeof buchungId === "string" && buchungId ? buchungId : null,
    art: gespeichert.art,
    // Der Name dient nur der Anzeige — abgelegt wird unter einer UUID.
    dateiname: (datei.name || "Datei").slice(0, 200),
    pfad: gespeichert.pfad,
    mime: gespeichert.mime,
    groesse: gespeichert.groesse,
    titel: typeof titel === "string" && titel ? titel.slice(0, 200) : null,
    hochgeladen_von: benutzer.id,
  });
  await protokolliere({ benutzer_id: benutzer.id, aktion: "hochgeladen", bereich: "datei", ziel_id: geraetId, ziel_text: datei.name });
  return c.json(ergebnis, 201);
});

/**
 * Ausliefern — MIT Anmeldeprüfung.
 *
 * Läge der Ordner im statisch ausgelieferten Bereich, wären alle
 * Baustellenfotos über eine geratene Adresse öffentlich. Diese Route ist
 * der einzige Weg an die Dateien.
 */
dateiRouten.get("/dateien/:id", async (c) => {
  const datei = await findeDatei(pfadId(c));
  const { strom, groesse } = await leseDatei(datei.pfad);

  c.header("Content-Type", datei.mime);
  c.header("Content-Length", String(groesse));
  // Der Dateiname wird in Anführungszeichen gesetzt und von Zeilenumbrüchen
  // befreit — sonst ließe sich über ihn ein zusätzlicher Kopfzeileneintrag
  // einschleusen.
  const sauber = datei.dateiname.replace(/["\r\n]/g, "");
  c.header("Content-Disposition", `inline; filename="${sauber}"`);
  // Privat: kein zwischengeschalteter Rechner soll Baustellenfotos behalten.
  c.header("Cache-Control", "private, max-age=3600");

  return c.body(strom as unknown as ReadableStream);
});

/**
 * Verkleinertes Vorschaubild — für Listen und das Board, wo 115 Originale
 * à 3 MB den Browser lahmlegen. Beim ersten Aufruf erzeugt, danach gecacht.
 */
dateiRouten.get("/dateien/:id/thumb", async (c) => {
  const datei = await findeDatei(pfadId(c));
  const thumb = await leseThumbnail(datei.pfad);

  if (!thumb) {
    const { strom, groesse } = await leseDatei(datei.pfad);
    c.header("Content-Type", datei.mime);
    c.header("Content-Length", String(groesse));
    c.header("Cache-Control", "private, max-age=86400");
    return c.body(strom as unknown as ReadableStream);
  }

  c.header("Content-Type", thumb.mime);
  c.header("Content-Length", String(thumb.puffer.length));
  c.header("Cache-Control", "private, max-age=86400");
  return c.body(new Uint8Array(thumb.puffer) as unknown as ReadableStream);
});

dateiRouten.post("/dateien/:id/titelbild", darf("dateien.verwalten"), async (c) => {
  const id = pfadId(c);
  const akteur = angemeldet(c);
  await setzeTitelbild(id);
  await protokolliere({ benutzer_id: akteur.id, aktion: "titelbild_gesetzt", bereich: "datei", ziel_id: pfadId(c) });
  return c.json({ ok: true });
});

dateiRouten.delete("/dateien/:id", darf("dateien.verwalten"), async (c) => {
  const akteur = angemeldet(c);
  await entferneDatei(pfadId(c));
  await protokolliere({ benutzer_id: akteur.id, aktion: "geloescht", bereich: "datei", ziel_id: pfadId(c) });
  return c.json({ ok: true });
});
