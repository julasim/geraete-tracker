/**
 * Die Karte „Zielpfad → Recht" (`web/src/rechte-pfade.ts`).
 *
 * **Die Falle bei genau diesem Test:** Fragt man `darfNach()` nach einer
 * Antwort und vergleicht sie mit derselben Karte, aus der sie kommt, ist der
 * Test bei jedem Fehler grün. In diesem Projekt sind schon sechs Gegenproben
 * grün geblieben, weil der Test das Falsche prüfte — hier wird deshalb
 * dreimal gegen etwas geprüft, das NICHT aus der Karte stammt:
 *
 * 1. gegen den **Quelltext** von `router.ts` (gibt es das Muster überhaupt
 *    als Route?),
 * 2. gegen die **Rechte der Server-Routen**, hier als Literale hingeschrieben
 *    (`POST /buchungen` verlangt `buchungen.erfassen` usw.),
 * 3. gegen die **im Code wirklich vorkommenden Zielpfade**, unabhängig aus
 *    `web/src` eingesammelt.
 *
 * Der dritte Punkt ist der wichtigste: Verliert die Karte einen Eintrag,
 * wird ein Knopf still frei — ohne ihn bliebe genau das unbemerkt, weil
 * `darfNach()` dann brav `true` sagt.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { RECHT_JE_PFAD, darfNach, rechtFuer } from "@/rechte-pfade";
import { useAnmeldung } from "@/stores/anmeldung";

/**
 * Der Quellordner auf der Platte.
 *
 * Nicht über `import.meta.url`: Unter jsdom ist das keine `file:`-Adresse,
 * `fileURLToPath()` wirft dort. Vitest läuft in `web/`; der zweite Zweig
 * fängt einen Aufruf aus dem Wurzelverzeichnis ab.
 */
const SRC = [resolve(process.cwd(), "src"), resolve(process.cwd(), "web/src")].find((p) =>
  existsSync(join(p, "router.ts")),
)!;

function dateien(ordner: string, gefunden: string[] = []): string[] {
  for (const eintrag of readdirSync(ordner)) {
    const pfad = join(ordner, eintrag);
    if (statSync(pfad).isDirectory()) dateien(pfad, gefunden);
    else if ([".vue", ".ts"].includes(extname(pfad))) gefunden.push(pfad);
  }
  return gefunden;
}

/** Die Rechte der mitgelieferten Rollen (`src/domain/rechte.ts`). */
const MITARBEITER = ["buchungen.erfassen", "schaeden.melden", "dateien.hochladen"];
const LAGER = [
  ...MITARBEITER,
  "geraete.pflegen",
  "stammdaten.pflegen",
  "pruefungen.eintragen",
  "schaeden.bearbeiten",
  "dateien.verwalten",
  "etiketten.drucken",
];

function alsBenutzer(rechte: string[]): void {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;
}

describe("Karte Zielpfad → Recht", () => {
  it("nennt nur Muster, die es in router.ts wirklich als Route gibt", () => {
    const quelle = readFileSync(join(SRC, "router.ts"), "utf8");
    const routen = [...quelle.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);

    // Ein Vertipper im Muster (`/sammeln/:kunst`) würde `rechtFuer()` still
    // `undefined` antworten lassen — der Knopf wäre für jeden sichtbar, und
    // kein anderer Test bemerkte es.
    for (const eintrag of RECHT_JE_PFAD) {
      expect(routen, `Muster ${eintrag.muster} steht in keiner Route`).toContain(eintrag.muster);
    }
  });

  it("beantwortet konkrete Pfade mit dem Recht der Server-Route", () => {
    // Links der Pfad, rechts das Recht, das der Server verlangt — von Hand
    // aus `src/api/routes/*` übernommen, ausdrücklich nicht aus der Karte.
    expect(rechtFuer("/buchen/abc-123/ausgabe")).toBe("buchungen.erfassen");
    expect(rechtFuer("/sammeln/ausgabe")).toBe("buchungen.erfassen");
    expect(rechtFuer("/sammeln/ruecknahme")).toBe("buchungen.erfassen");
    expect(rechtFuer("/geraete/neu")).toBe("geraete.pflegen");
    expect(rechtFuer("/geraete/abc-123/bearbeiten")).toBe("geraete.pflegen");
    expect(rechtFuer("/etiketten")).toBe("etiketten.drucken");
    expect(rechtFuer("/austausch")).toBe("daten.austauschen");
    expect(rechtFuer("/benutzer")).toBe("benutzer.verwalten");
    expect(rechtFuer("/benutzer/neu")).toBe("benutzer.verwalten");
    expect(rechtFuer("/benutzer/abc-123")).toBe("benutzer.verwalten");
    expect(rechtFuer("/rollen")).toBe("benutzer.verwalten");
  });

  it("lässt frei, was frei ist — Lesen ist in dieser Anwendung kein Recht", () => {
    expect(rechtFuer("/geraete")).toBeUndefined();
    // Darf NICHT auf /geraete/neu oder /geraete/:id/bearbeiten hereinfallen.
    expect(rechtFuer("/geraete/abc-123")).toBeUndefined();
    expect(rechtFuer("/pakete")).toBeUndefined();
    expect(rechtFuer("/stammdaten")).toBeUndefined();
    expect(rechtFuer("/pruefungen")).toBeUndefined();
    expect(rechtFuer("/orte")).toBeUndefined();
    expect(rechtFuer("/scan")).toBeUndefined();
  });

  it("schneidet Abfrage und Anker ab", () => {
    // `/geraete?status=ausgegeben` kommt in der Übersicht wirklich vor.
    expect(rechtFuer("/geraete?status=ausgegeben")).toBeUndefined();
    expect(rechtFuer("/sammeln/ausgabe?woher=paket")).toBe("buchungen.erfassen");
    expect(rechtFuer("/etiketten#bogen")).toBe("etiketten.drucken");
  });

  it("beantwortet darfNach() für die mitgelieferten Rollen", () => {
    alsBenutzer(MITARBEITER);
    expect(darfNach("/sammeln/ausgabe")).toBe(true);
    expect(darfNach("/buchen/abc-123/ausgabe")).toBe(true);
    expect(darfNach("/pakete")).toBe(true);
    expect(darfNach("/etiketten")).toBe(false);
    expect(darfNach("/geraete/neu")).toBe(false);
    expect(darfNach("/austausch")).toBe(false);
    expect(darfNach("/benutzer")).toBe(false);

    alsBenutzer(LAGER);
    expect(darfNach("/geraete/neu")).toBe(true);
    expect(darfNach("/geraete/abc-123/bearbeiten")).toBe(true);
    expect(darfNach("/etiketten")).toBe(true);
    // Ausmustern, Import/Export und Benutzer bleiben der Verwaltung.
    expect(darfNach("/austausch")).toBe(false);
    expect(darfNach("/benutzer")).toBe(false);

    alsBenutzer([]);
    expect(darfNach("/sammeln/ausgabe")).toBe(false);
    // Ohne jedes Recht bleibt der Bestand trotzdem lesbar.
    expect(darfNach("/geraete")).toBe(true);
    expect(darfNach("/pruefungen")).toBe(true);
  });

  /**
   * Der Fangtest gegen eine schrumpfende Karte.
   *
   * Eingesammelt werden die Zielpfade, die im Code **literal** stehen —
   * `router.push("…")`, `to="…"`, `pfad: "…"` in den Navigationslisten und
   * `darfNach("…")`. Zusammengesetzte Pfade (`/buchen/${id}/${art}`) fallen
   * absichtlich heraus: Sie sind keine Literale und ließen sich nur raten.
   *
   * `router.ts` und `rechte-pfade.ts` bleiben außen vor — sonst prüfte die
   * Karte sich selbst.
   */
  it("deckt jeden geschützten Zielpfad ab, der im Code steht", () => {
    // Beide Anführungszeichen: Im Template steht `router.push('/rollen')`
    // innerhalb eines `@click="…"`, im Script steht `"…"`. Die erste Fassung
    // dieses Sammlers kannte nur doppelte und übersah dadurch zwei Ziele.
    const MUSTER = [
      /(?:push|replace)\(\s*["'](\/[^"'$]*)["']/g,
      /\s:?to="'?(\/[^"'$]*)'?"/g,
      /pfad:\s*["'](\/[^"'$]*)["']/g,
      /darfNach\(\s*["'](\/[^"'$]*)["']/g,
    ];

    const ziele = new Set<string>();
    for (const datei of dateien(SRC)) {
      if (datei.endsWith("router.ts") || datei.endsWith("rechte-pfade.ts")) continue;
      const quelle = readFileSync(datei, "utf8");
      for (const muster of MUSTER) {
        for (const treffer of quelle.matchAll(muster)) ziele.add(treffer[1]!);
      }
    }

    // Der Fund muss überhaupt etwas hergeben — findet der Sammler nichts,
    // wäre der Vergleich unten wertlos.
    expect(ziele.size).toBeGreaterThan(15);

    const geschuetzt = [...ziele].filter((z) => rechtFuer(z)).sort();

    // Diese Liste steht als Literal da, nicht als Ableitung aus der Karte:
    // Verschwindet ein Eintrag aus der Karte, fällt sein Pfad aus `geschuetzt`
    // und der Test schlägt an — der zugehörige Knopf wäre sonst ab sofort für
    // jeden sichtbar.
    //
    // Geprüft wird bewusst nur DIESE Richtung. Ein `toEqual` würde auch
    // anschlagen, wenn jemand einen Knopf umbaut (etwa `router.push('/rollen')`
    // durch ein gebundenes Ziel ersetzt) — ein Fehlalarm ohne Rechtefehler.
    // Einem Prüfwerkzeug, das Fehlalarme gibt, glaubt bald niemand mehr.
    for (const pfad of [
      "/austausch",
      "/benutzer",
      "/benutzer/neu",
      "/etiketten",
      "/geraete/neu",
      "/rollen",
      "/sammeln/ausgabe",
    ]) {
      expect(geschuetzt).toContain(pfad);
    }
  });
});
