/**
 * Die Baustellen-Anlage in der Ortsansicht.
 *
 * Bis hierher war das nur im Browser abgenommen. Geprüft wird, was still
 * kaputtgehen kann, ohne dass eine Typprüfung anschlägt:
 *
 * * Der Anlegen-Knopf darf bei leerem Namen nicht auslösen — sonst schickt
 *   ein Fehlgriff einen leeren Ort an den Server.
 * * Die Dublettenwarnung muss greifen, BEVOR gespeichert wird. Ohne sie
 *   stehen mit der Zeit „Lindengasse", „Lindengasse 14" und „lindengasse"
 *   nebeneinander, und der Bestand verteilt sich auf drei Orte, die dasselbe
 *   meinen.
 * * Ohne das Recht `stammdaten.pflegen` darf das Formular gar nicht
 *   erscheinen (der Server weist es ohnehin ab, aber ein Knopf, der immer
 *   403 liefert, ist eine Zumutung).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { mount } from "@vue/test-utils";
import OrteView from "@/views/OrteView.vue";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Standort } from "@/typen";

const gesendet = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), patch: vi.fn() }));

vi.mock("@/api", () => ({
  api: gesendet,
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      meldung: string,
    ) {
      super(meldung);
    }
  },
}));

function ort(id: string, name: string): Standort {
  return { id, name, typ: "baustelle", adresse: null, notiz: null, aktiv: true } as Standort;
}

async function baueAnsicht(rechte: string[]) {
  setActivePinia(createPinia());
  const anmeldung = useAnmeldung();
  anmeldung.rechte = rechte;
  const bestand = useBestand();
  bestand.standorte = [ort("s1", "Bauhof Nord")];
  bestand.laden = vi.fn().mockResolvedValue(undefined);

  const ansicht = mount(OrteView, {
    global: { stubs: { RouterLink: true, Kopf: true, Symbol: true } },
  });
  await ansicht.vm.$nextTick();
  return { ansicht, bestand };
}

describe("Baustelle anlegen", () => {
  beforeEach(() => {
    gesendet.post.mockReset();
    gesendet.get.mockReset().mockResolvedValue({ geraete: [] });
    gesendet.patch.mockReset();
  });

  it("zeigt den Anlegen-Knopf nur mit dem Recht dafür", async () => {
    const ohne = await baueAnsicht([]);
    expect(ohne.ansicht.text()).not.toContain("Neue Baustelle anlegen");

    const mit = await baueAnsicht(["stammdaten.pflegen"]);
    expect(mit.ansicht.text()).toContain("Neue Baustelle anlegen");
  });

  it("schickt nichts ab, solange kein Name eingetragen ist", async () => {
    const { ansicht } = await baueAnsicht(["stammdaten.pflegen"]);
    await ansicht.find("button").trigger("click"); // Formular öffnen
    const knopf = ansicht.findAll("button").find((b) => b.text() === "Anlegen");
    expect(knopf?.attributes("disabled")).toBeDefined();
    await knopf?.trigger("click");
    expect(gesendet.post).not.toHaveBeenCalled();
  });

  it("warnt vor einem ähnlichen Ort, blockiert das Anlegen aber nicht", async () => {
    const { ansicht } = await baueAnsicht(["stammdaten.pflegen"]);
    await ansicht.find("button").trigger("click");
    await ansicht.find("#neu-name").setValue("Bauhof");
    await ansicht.vm.$nextTick();

    expect(ansicht.text()).toContain("Es gibt bereits");
    expect(ansicht.text()).toContain("Bauhof Nord");

    // Die Warnung ist ein Hinweis, kein Riegel: Es kann eine zweite
    // Baustelle in derselben Straße sein.
    const knopf = ansicht.findAll("button").find((b) => b.text() === "Anlegen");
    expect(knopf?.attributes("disabled")).toBeUndefined();
  });

  it("legt an und pflegt den Ort sofort in den Bestand ein", async () => {
    gesendet.post.mockResolvedValue(ort("s2", "Lindengasse 14"));
    const { ansicht, bestand } = await baueAnsicht(["stammdaten.pflegen"]);
    await ansicht.find("button").trigger("click");
    await ansicht.find("#neu-name").setValue("Lindengasse 14");
    // jsdom löst bei einem Klick auf type="submit" KEIN submit aus (anders
    // als jeder echte Browser). Deshalb das Formular direkt absenden.
    await ansicht.find("form").trigger("submit");
    await ansicht.vm.$nextTick();

    expect(gesendet.post).toHaveBeenCalledWith("/standorte", {
      name: "Lindengasse 14",
      typ: "baustelle",
      adresse: null,
    });
    // Das ist der Kern von „automatisch hinterlegt": ohne Neuladen verfügbar.
    expect(bestand.standorte.map((s) => s.name)).toContain("Lindengasse 14");
  });

  it("schickt eine leere Adresse als null, nicht als leeren Text", async () => {
    gesendet.post.mockResolvedValue(ort("s2", "Ahornweg"));
    const { ansicht } = await baueAnsicht(["stammdaten.pflegen"]);
    await ansicht.find("button").trigger("click");
    await ansicht.find("#neu-name").setValue("  Ahornweg  ");
    await ansicht.find("form").trigger("submit");

    // Name getrimmt, Adresse null — sonst stünde in der Datenbank ein
    // leerer Text, der sich von „nicht angegeben" nicht unterscheiden lässt.
    expect(gesendet.post).toHaveBeenCalledWith("/standorte", {
      name: "Ahornweg",
      typ: "baustelle",
      adresse: null,
    });
  });
});
