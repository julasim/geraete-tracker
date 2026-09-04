/**
 * Der Wächter des Routers.
 *
 * Er entscheidet nicht über den Zugang — das tut der Server. Er entscheidet
 * darüber, ob jemand in eine Ansicht läuft, die ihm nichts nützt. Bis AP25
 * trug `/buchen/:id/:art` als einzige Buchungsroute **kein** Recht, während
 * die Schwesterroute `/sammeln/:art` eines trug.
 *
 * Dieser Test hängt am **echten** Router (kein Mock von `vue-router`) —
 * anders ließe sich der Wächter nicht ausführen. Er ist deshalb der einzige
 * Test der Oberfläche, der das Modul `@/router` überhaupt lädt.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { router } from "@/router";
import { useAnmeldung } from "@/stores/anmeldung";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock("@/api", () => ({
  api,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      meldung: string,
    ) {
      super(meldung);
    }
  },
}));

/** Angemeldet sein und diese Rechte haben. */
function alsBenutzer(rechte: string[]): void {
  setActivePinia(createPinia());
  const anmeldung = useAnmeldung();
  anmeldung.benutzer = { id: "b1", anzeigename: "Prüfkonto" } as never;
  anmeldung.rechte = rechte;
  anmeldung.passwortWechselNoetig = false;
  // `geprueft` verhindert, dass der Wächter `/auth/me` nachschlägt.
  anmeldung.geprueft = true;
}

/**
 * Ein Ziel ansteuern und sagen, wo man gelandet ist.
 *
 * Der Zwischenschritt über `/pruefungen` ist nötig, nicht kosmetisch: Der
 * Router verweigert eine Navigation an die Stelle, an der man schon steht —
 * der Wächter käme dann gar nicht zum Zug, und die zweite Hälfte jedes Tests
 * (dieselbe Adresse, andere Rechte) bliebe stumm grün. Genau so ist der
 * erste Lauf dieses Tests fälschlich durchgegangen.
 * `/pruefungen` verlangt kein Recht und ist deshalb als Ausgangspunkt
 * geeignet.
 */
async function gehe(ziel: string): Promise<string> {
  await router.replace("/pruefungen").catch(() => undefined);
  await router.push(ziel).catch(() => undefined);
  return router.currentRoute.value.path;
}

describe("Router-Wächter", () => {
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue([]);
    // `scrollBehavior` ruft nach jeder Navigation `window.scrollTo` — jsdom
    // kennt das nicht und schreibt bei jedem Sprung eine Zeile nach stderr.
    vi.stubGlobal("scrollTo", vi.fn());
  });

  it("lässt die Buchungsroute nur mit buchungen.erfassen durch", async () => {
    alsBenutzer(["buchungen.erfassen"]);
    expect(await gehe("/buchen/g1/ausgabe")).toBe("/buchen/g1/ausgabe");

    alsBenutzer(["geraete.pflegen"]);
    expect(await gehe("/buchen/g1/ausgabe")).toBe("/geraete");
  });

  it("hält die Sammelbuchung genauso zurück", async () => {
    alsBenutzer(["buchungen.erfassen"]);
    expect(await gehe("/sammeln/ausgabe")).toBe("/sammeln/ausgabe");

    alsBenutzer([]);
    expect(await gehe("/sammeln/ausgabe")).toBe("/geraete");
  });

  it("hält die Etiketten- und Austauschansicht zurück", async () => {
    alsBenutzer(["etiketten.drucken", "daten.austauschen"]);
    expect(await gehe("/etiketten")).toBe("/etiketten");
    expect(await gehe("/austausch")).toBe("/austausch");

    alsBenutzer([]);
    expect(await gehe("/etiketten")).toBe("/geraete");
    expect(await gehe("/austausch")).toBe("/geraete");
  });

  it("lässt jeden Angemeldeten lesen", async () => {
    alsBenutzer([]);
    expect(await gehe("/geraete")).toBe("/geraete");
    expect(await gehe("/pakete")).toBe("/pakete");
    expect(await gehe("/stammdaten")).toBe("/stammdaten");
    expect(await gehe("/pruefungen")).toBe("/pruefungen");
    // Auch die Gerätekarte selbst — sie darf nicht am Muster
    // `/geraete/:id/bearbeiten` hängen bleiben.
    expect(await gehe("/geraete/abc-123")).toBe("/geraete/abc-123");
  });

  it("schickt den Nicht-Angemeldeten zur Anmeldung", async () => {
    setActivePinia(createPinia());
    const anmeldung = useAnmeldung();
    anmeldung.geprueft = true;
    expect(await gehe("/geraete")).toBe("/anmelden");
  });
});
