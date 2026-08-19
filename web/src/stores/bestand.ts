import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api } from "@/api";
import type { Geraet, Lagerplatz, Schlagwort, Standort } from "@/typen";

/**
 * Der Bestand, einmal geladen.
 *
 * Bei rund 200 Geräten wird die ganze Liste geholt und im Browser gefiltert
 * und durchsucht. Das ist auf der Baustelle spürbar besser als ein
 * Serveraufruf je Tastendruck — die Trefferliste steht sofort, auch bei
 * mäßigem Mobilfunk.
 */
export const useBestand = defineStore("bestand", () => {
  const geraete = ref<Geraet[]>([]);
  const standorte = ref<Standort[]>([]);
  const lagerplaetze = ref<Lagerplatz[]>([]);
  const schlagworte = ref<Schlagwort[]>([]);

  const laedt = ref(false);
  const geladenAm = ref<number | null>(null);

  const aktiveStandorte = computed(() => standorte.value.filter((s) => s.aktiv));
  const lager = computed(() => aktiveStandorte.value.filter((s) => s.typ === "lager"));
  const baustellen = computed(() => aktiveStandorte.value.filter((s) => s.typ === "baustelle"));

  const zahlen = computed(() => ({
    gesamt: geraete.value.length,
    ausgegeben: geraete.value.filter((g) => g.status === "ausgegeben").length,
    verfuegbar: geraete.value.filter((g) => g.status === "verfuegbar").length,
    defekt: geraete.value.filter((g) => g.status === "defekt" || g.status === "wartung").length,
  }));

  async function laden(erzwingen = false): Promise<void> {
    // Ohne diese Bremse lädt jeder Ansichtswechsel alles neu.
    if (!erzwingen && geladenAm.value && Date.now() - geladenAm.value < 30_000) return;

    laedt.value = true;
    try {
      const [g, s, p, w] = await Promise.all([
        api.get<Geraet[]>("/geraete"),
        api.get<Standort[]>("/standorte"),
        api.get<Lagerplatz[]>("/lagerplaetze"),
        api.get<Schlagwort[]>("/schlagworte"),
      ]);
      geraete.value = g;
      standorte.value = s;
      lagerplaetze.value = p;
      schlagworte.value = w;
      geladenAm.value = Date.now();
    } finally {
      laedt.value = false;
    }
  }

  /** Ein einzelnes Gerät nach einer Buchung auffrischen. */
  function ersetze(geraet: Geraet): void {
    const i = geraete.value.findIndex((g) => g.id === geraet.id);
    if (i >= 0) geraete.value[i] = geraet;
    else geraete.value.push(geraet);
  }

  const nachId = (id: string) => geraete.value.find((g) => g.id === id) ?? null;

  const plaetzeAmStandort = (standortId: string) =>
    lagerplaetze.value.filter((p) => p.standort_id === standortId && p.aktiv);

  /**
   * Suche über alles, was auf einem Etikett oder Typenschild steht.
   * Mehrere Wörter müssen alle vorkommen, Reihenfolge egal.
   */
  function suche(text: string): Geraet[] {
    const woerter = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!woerter.length) return geraete.value;

    return geraete.value.filter((g) => {
      const heuhaufen = [
        g.bezeichnung,
        g.inventarnummer,
        g.hersteller,
        g.modell,
        g.seriennummer,
        g.standort,
        g.nutzer,
        ...g.schlagworte.map((s) => s.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return woerter.every((w) => heuhaufen.includes(w));
    });
  }

  function leeren(): void {
    geraete.value = [];
    standorte.value = [];
    lagerplaetze.value = [];
    schlagworte.value = [];
    geladenAm.value = null;
  }

  return {
    geraete,
    standorte,
    lagerplaetze,
    schlagworte,
    laedt,
    aktiveStandorte,
    lager,
    baustellen,
    zahlen,
    laden,
    ersetze,
    nachId,
    plaetzeAmStandort,
    suche,
    leeren,
  };
});
