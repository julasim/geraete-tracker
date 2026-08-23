/**
 * Der Sicherungsstand.
 *
 * Eine Sicherung, die nachts per cron läuft und scheitert, merkt sonst
 * niemand — bis sie gebraucht wird. Es gibt in dieser Anwendung bewusst
 * keinen Mailversand, also nimmt die Meldung den umgekehrten Weg:
 * `scripts/sicherung.sh` legt den Ausgang als Datei ab, die Übersicht zeigt
 * ihn an.
 *
 * Geprüft wird hier, dass die Anwendung die Datei richtig liest — und dass
 * ein defekter oder fehlender Stand nichts kaputt macht, sondern schlicht
 * „nichts bekannt" ergibt.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA_PATH } from "../src/config.js";
import { schliesseDb } from "../src/db/client.js";
import { mitCookie } from "./helpers/konten.js";
import { alsAdmin, alsMitarbeiter, raeumeKontenAuf, type Sitzung } from "./helpers/stammdaten.js";

const DATEI = resolve(DATA_PATH, "sicherung-stand.json");

let admin: Sitzung;
let mitarbeiter: Sitzung;

/** Merkt sich, was vorher dastand — die Entwicklungsumgebung nutzt dieselbe Datei. */
let vorher: string | null = null;

beforeAll(async () => {
  admin = await alsAdmin();
  mitarbeiter = await alsMitarbeiter();
  await mkdir(DATA_PATH, { recursive: true });
  try {
    const { readFile } = await import("node:fs/promises");
    vorher = await readFile(DATEI, "utf8");
  } catch {
    vorher = null;
  }
});

beforeEach(async () => {
  // VOR jedem Test, nicht danach: Sonst startet der erste Test mit dem, was
  // die Umgebung gerade dort liegen hat — beim Bauen genau so passiert.
  await rm(DATEI, { force: true });
});

afterAll(async () => {
  // Den vorgefundenen Zustand wiederherstellen: Diese Datei gehört der
  // Umgebung, nicht dem Test.
  if (vorher !== null) await writeFile(DATEI, vorher, "utf8");
  await raeumeKontenAuf();
  await schliesseDb();
});

async function stand(cookie: string) {
  const antwort = await mitCookie("/api/sicherung/stand", cookie);
  return { status: antwort.status, daten: await antwort.json().catch(() => null) };
}

describe("Sicherungsstand", () => {
  it("meldet nichts, solange nie gesichert wurde", async () => {
    const { status, daten } = await stand(admin.cookie);
    expect(status).toBe(200);
    // Bewusst null statt eines erfundenen Zustands: Eine frische Anlage hat
    // keinen Stand, und die Oberfläche sagt genau das ("Noch nie gesichert").
    expect(daten).toBeNull();
  });

  it("liest einen erfolgreichen Lauf und rechnet die Tage aus", async () => {
    const vorDreiTagen = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await writeFile(
      DATEI,
      JSON.stringify({
        ausgang: "erfolg",
        zeitpunkt: vorDreiTagen,
        stempel: "2026-08-20_0200",
        ziel: "/mnt/nas/tracker",
        meldung: "Datenbank und Dateien gesichert.",
      }),
      "utf8",
    );

    const { daten } = await stand(admin.cookie);
    expect(daten).toMatchObject({ ausgang: "erfolg", tage_her: 3, ziel: "/mnt/nas/tracker" });
  });

  it("gibt einen Fehlschlag als solchen weiter", async () => {
    await writeFile(
      DATEI,
      JSON.stringify({
        ausgang: "fehler",
        zeitpunkt: new Date().toISOString(),
        stempel: "",
        ziel: "./sicherung",
        meldung: "Die Sicherung ist abgebrochen.",
      }),
      "utf8",
    );

    const { daten } = await stand(admin.cookie);
    expect((daten as { ausgang: string }).ausgang).toBe("fehler");
  });

  it("verschluckt sich nicht an einer kaputten Datei", async () => {
    // Ein abgebrochener Schreibvorgang hinterlässt halbes JSON. Das darf die
    // Übersicht nicht mitreißen — sie zeigt dann "noch nie gesichert", was
    // ehrlicher ist als eine Fehlermeldung über eine Nebensache.
    await writeFile(DATEI, '{"ausgang": "erfo', "utf8");
    const { status, daten } = await stand(admin.cookie);
    expect(status).toBe(200);
    expect(daten).toBeNull();
  });

  it("verschluckt sich nicht an einem unbrauchbaren Zeitpunkt", async () => {
    await writeFile(DATEI, JSON.stringify({ ausgang: "erfolg", zeitpunkt: "vorgestern" }), "utf8");
    const { daten } = await stand(admin.cookie);
    expect(daten).toBeNull();
  });

  it("zeigt einem Mitarbeiter den Zustand der Anlage nicht", async () => {
    await writeFile(
      DATEI,
      JSON.stringify({ ausgang: "fehler", zeitpunkt: new Date().toISOString() }),
      "utf8",
    );
    const { status } = await stand(mitarbeiter.cookie);
    expect(status).toBe(403);
  });
});
