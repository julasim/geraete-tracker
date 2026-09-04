/**
 * Der Abschnitt „Verwaltung" der Mehr-Ansicht (Handy).
 *
 * Die Ansicht hatte bis AP25 keinen Test — und genau hier saß der Fehler,
 * der einem Mitarbeiter Ansichten vorenthielt, die er ausdrücklich sehen
 * darf: Über der ganzen Liste stand ein `v-if="darf('geraete.pflegen') ||
 * istVerwaltung"`, während die Einträge darin ganz andere Rechte verlangen.
 *
 * Geprüft wird deshalb zweierlei:
 *
 * * **Jeder Eintrag hängt an SEINEM Recht**, nicht am Recht des Abschnitts.
 * * **Freie Ansichten bleiben frei.** „Pakete" und „Schlagworte und
 *   Prüfarten" verlangen nichts — sie müssen auch dem Mitarbeiter erscheinen,
 *   der sonst kein einziges Verwaltungsrecht hat.
 *
 * Die Rechte-Listen unten sind die der mitgelieferten Rollen aus
 * `src/domain/rechte.ts`; sie stehen hier als Literale, damit der Test nicht
 * dieselbe Quelle befragt wie die Ansicht.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { h, type VNode } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import MehrView from "@/views/MehrView.vue";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
const geschoben = vi.hoisted(() => vi.fn());

vi.mock("@/api", () => ({
  api,
  ApiError: class ApiError extends Error {},
}));

// MehrView holt `RouterLink` als Import, nicht als globale Komponente — der
// Mock muss ihn deshalb mitliefern. Eine Render-Funktion statt eines
// `template`: Vite bündelt Vue ohne Übersetzer.
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: geschoben, replace: vi.fn() }),
  RouterLink: {
    name: "RouterLink",
    props: { to: { type: [String, Object], required: true } },
    setup:
      (_props: unknown, { slots }: { slots: { default?: () => VNode[] } }) =>
      () =>
        h("a", null, slots.default?.() ?? []),
  },
}));

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
const VERWALTUNG = [...LAGER, "geraete.ausmustern", "buchungen.korrigieren", "daten.austauschen", "benutzer.verwalten"];

async function baue(rechte: string[]) {
  setActivePinia(createPinia());
  useAnmeldung().rechte = rechte;
  const bestand = useBestand();
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  const ansicht = mount(MehrView, { global: { stubs: { Kopf: true } } });
  await new Promise((f) => setTimeout(f, 0));
  await ansicht.vm.$nextTick();
  return ansicht;
}

describe("Mehr-Ansicht: Abschnitt Verwaltung", () => {
  beforeEach(() => {
    geschoben.mockReset();
    // Kein Beiwerk: Die Übersichtslisten bleiben leer, geprüft werden die
    // Einträge darunter.
    api.get.mockReset().mockResolvedValue([]);
  });

  it("zeigt dem Mitarbeiter die freien Ansichten — und sonst nichts", async () => {
    const ansicht = await baue(MITARBEITER);
    const text = ansicht.text();

    // Das war der Befund: Der ganze Abschnitt fehlte, also auch diese zwei.
    expect(text).toContain("Pakete");
    expect(text).toContain("Schlagworte und Prüfarten");

    expect(text).not.toContain("Gerät anlegen");
    expect(text).not.toContain("Import und Export");
    expect(text).not.toContain("Etiketten drucken");
    expect(text).not.toContain("Benutzer und Rollen");
  });

  it("zeigt Lager und Werkstatt genau seine Einträge", async () => {
    const text = (await baue(LAGER)).text();
    expect(text).toContain("Gerät anlegen");
    expect(text).toContain("Etiketten drucken");
    expect(text).toContain("Pakete");
    // Import/Export und Benutzerverwaltung bleiben der Verwaltung vorbehalten.
    expect(text).not.toContain("Import und Export");
    expect(text).not.toContain("Benutzer und Rollen");
  });

  it("zeigt der Verwaltung alles", async () => {
    const text = (await baue(VERWALTUNG)).text();
    expect(text).toContain("Gerät anlegen");
    expect(text).toContain("Import und Export");
    expect(text).toContain("Etiketten drucken");
    expect(text).toContain("Benutzer und Rollen");
  });

  it("führt jeden Eintrag auf seinen eigenen Pfad", async () => {
    const ansicht = await baue(VERWALTUNG);
    const knopf = ansicht
      .findAll("button")
      .find((k) => k.text().startsWith("Import und Export"));
    await knopf!.trigger("click");
    expect(geschoben).toHaveBeenCalledWith("/austausch");
  });

  it("behält den Abschnitt auch ohne jedes Recht — wegen der freien Einträge", async () => {
    // Der Abschnitt verschwindet erst, wenn AUCH die freien Einträge weg
    // wären; die gibt es aber immer. Dass er hier stehen bleibt, ist also
    // kein Zufall, sondern der Zweck des Umbaus: Er hängt an seinem Inhalt,
    // nicht an einem Recht darüber.
    const ansicht = await baue([]);
    expect(ansicht.text()).toContain("Verwaltung");
    expect(ansicht.text()).toContain("Pakete");
    expect(ansicht.text()).not.toContain("Gerät anlegen");
  });
});
