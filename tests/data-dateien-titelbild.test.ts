/**
 * Welches Bild wird zum Titelbild eines Geräts?
 *
 * Das erste Foto eines Geräts wird von selbst zum Titelbild, damit die
 * Geräteliste nicht grau bleibt, bis jemand daran denkt, eines auszuwählen.
 *
 * Seit es **Zustandsfotos bei der Übergabe** gibt (an einer Buchung hängend),
 * braucht diese Regel eine Ausnahme: Ein Bild vom Hänger im Regen zeigt einen
 * Moment, nicht das Gerät. Ohne die Ausnahme trüge ein Gerät, das noch nie
 * fotografiert wurde, fortan den ersten Schnappschuss einer Ausgabe als
 * Titelbild — beim Einbau genau so passiert und in der Abnahme gesehen.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schliesseDb } from "../src/db/client.js";
import { speichereDatei } from "../src/data/dateien.js";
import { alsAdmin, raeumeKontenAuf, type Sitzung } from "./helpers/stammdaten.js";

let admin: Sitzung;
let geraetId: string;
let buchungId: string;

beforeAll(async () => {
  admin = await alsAdmin();

  const [g] = await db()<{ id: string }[]>`
    INSERT INTO geraete (inventarnummer, bezeichnung)
    VALUES ('98765', 'TEST-Titelbild Prüfgerät') RETURNING id`;
  geraetId = g!.id;

  const [b] = await db()<{ id: string }[]>`
    INSERT INTO buchungen (geraet_id, art, erfasst_von)
    VALUES (${geraetId}, 'ausgabe', ${admin.konto.id}) RETURNING id`;
  buchungId = b!.id;
});

afterAll(async () => {
  await db()`DELETE FROM dateien WHERE geraet_id = ${geraetId}`;
  // Die Unveränderlichkeitsregeln müssen zum Aufräumen kurz weichen.
  await db()`DROP RULE IF EXISTS buchungen_kein_delete ON buchungen`;
  await db()`DROP RULE IF EXISTS buchungen_kein_update ON buchungen`;
  await db()`DELETE FROM buchungen WHERE geraet_id = ${geraetId}`;
  await db()`CREATE RULE buchungen_kein_update AS ON UPDATE TO buchungen DO INSTEAD NOTHING`;
  await db()`CREATE RULE buchungen_kein_delete AS ON DELETE TO buchungen DO INSTEAD NOTHING`;
  await db()`DELETE FROM etikettennummern WHERE geraet_id = ${geraetId}`;
  await db()`DELETE FROM geraete_barcodes WHERE geraet_id = ${geraetId}`;
  await db()`DELETE FROM geraete WHERE id = ${geraetId}`;
  await raeumeKontenAuf();
  await schliesseDb();
});

function bild(zusatz: Partial<Parameters<typeof speichereDatei>[0]> = {}) {
  return speichereDatei({
    geraet_id: geraetId,
    art: "foto",
    dateiname: "bild.jpg",
    pfad: `test/${Math.random().toString(36).slice(2)}.jpg`,
    mime: "image/jpeg",
    groesse: 1024,
    hochgeladen_von: admin.konto.id,
    ...zusatz,
  });
}

describe("Titelbild eines Geräts", () => {
  it("ein Zustandsfoto von einer Übergabe wird NIE Titelbild", async () => {
    // Der eigentliche Punkt: Auch als allererstes Bild des Geräts nicht.
    const uebergabe = await bild({ buchung_id: buchungId });
    expect(uebergabe.ist_titelbild).toBe(false);
    expect(uebergabe.buchung_id).toBe(buchungId);
  });

  it("das erste Gerätefoto wird zum Titelbild — auch nach einem Zustandsfoto", async () => {
    const geraetefoto = await bild();
    expect(geraetefoto.ist_titelbild).toBe(true);
  });

  it("weitere Gerätefotos werden es nicht", async () => {
    const zweites = await bild();
    expect(zweites.ist_titelbild).toBe(false);
  });

  it("ein Dokument wird nie Titelbild", async () => {
    const pdf = await bild({ art: "dokument", dateiname: "protokoll.pdf", mime: "application/pdf" });
    expect(pdf.ist_titelbild).toBe(false);
  });
});
