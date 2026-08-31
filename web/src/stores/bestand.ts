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

  /**
   * Einen neu angelegten oder geänderten Standort einpflegen.
   *
   * Ohne das müsste der ganze Bestand neu geladen werden, damit eine gerade
   * angelegte Baustelle in den Auswahlfeldern auftaucht — bei rund 200
   * Geräten ein spürbarer Aufruf, und auf der Baustelle einer über Mobilfunk.
   * So steht sie sofort überall zur Verfügung, wo Standorte gewählt werden.
   */
  function ergaenzeStandort(standort: Standort): void {
    const i = standorte.value.findIndex((s) => s.id === standort.id);
    if (i >= 0) standorte.value[i] = standort;
    else standorte.value.push(standort);
  }

  /**
   * Die Geräte, die gerade für eine Sammelbuchung zusammengetragen werden.
   *
   * Bewusst **nur im Arbeitsspeicher**, nicht im localStorage: Eine halb
   * fertige Sammlung von gestern ist eine Falle — wer die App am nächsten
   * Morgen öffnet, bucht sonst versehentlich vier Geräte mit, die längst
   * woanders stehen.
   */
  const sammlung = ref<string[]>([]);

  const sammelt = computed(() => sammlung.value.length > 0);

  function sammle(geraetId: string): void {
    // Zweimal denselben Barcode zu scannen ist der Normalfall, wenn man
    // zwischendurch abgelenkt wird. Das darf nichts verdoppeln.
    if (!sammlung.value.includes(geraetId)) sammlung.value.push(geraetId);
  }

  function entsammle(geraetId: string): void {
    const i = sammlung.value.indexOf(geraetId);
    if (i >= 0) sammlung.value.splice(i, 1);
  }

  function sammlungLeeren(): void {
    sammlung.value = [];
  }

  /** Die gesammelten Geräte als Datensätze, in der Reihenfolge des Scannens. */
  const gesammelteGeraete = computed(() =>
    sammlung.value.map((id) => geraete.value.find((g) => g.id === id)).filter(Boolean),
  );

  /** Wie ergaenzeStandort, für Lagerplätze. */
  function ergaenzeLagerplatz(platz: Lagerplatz): void {
    const i = lagerplaetze.value.findIndex((p) => p.id === platz.id);
    if (i >= 0) lagerplaetze.value[i] = platz;
    else lagerplaetze.value.push(platz);
  }

  /** Wie ergaenzeStandort, für Schlagworte. */
  function ergaenzeSchlagwort(wort: Schlagwort): void {
    const i = schlagworte.value.findIndex((w) => w.id === wort.id);
    if (i >= 0) schlagworte.value[i] = wort;
    else schlagworte.value.push(wort);
  }

  /** Ein gelöschtes Schlagwort aus der Liste nehmen. */
  function entferneSchlagwort(id: string): void {
    const i = schlagworte.value.findIndex((w) => w.id === id);
    if (i >= 0) schlagworte.value.splice(i, 1);
    // Auch an den Geräten: Sonst zeigt die Liste ein Schlagwort, das es
    // nicht mehr gibt, bis jemand die Seite neu lädt.
    for (const g of geraete.value) {
      if (g.schlagworte?.length) g.schlagworte = g.schlagworte.filter((w) => w.id !== id);
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
   *
   * **Reine Ziffern werden als Etikettennummer verstanden** und die Treffer
   * danach sortiert, nicht alphabetisch nach Bezeichnung. Wer `1001` eintippt
   * — der Normalfall, wenn die Kamera streikt oder das Etikett verschmutzt
   * ist —, sucht die Nummer und bekam vorher 10011, 10010, 10015, 10016 in
   * der Reihenfolge der Gerätenamen. Nummern, die mit der Eingabe beginnen,
   * stehen jetzt vorn und aufsteigend; alles andere folgt.
   */
  function suche(text: string): Geraet[] {
    const eingabe = text.trim();
    const woerter = eingabe.toLowerCase().split(/\s+/).filter(Boolean);
    if (!woerter.length) return geraete.value;

    const treffer = geraete.value.filter((g) => {
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

    if (!/^\d+$/.test(eingabe)) return treffer;

    return [...treffer].sort((a, b) => {
      const beginntA = a.inventarnummer?.startsWith(eingabe) ? 0 : 1;
      const beginntB = b.inventarnummer?.startsWith(eingabe) ? 0 : 1;
      if (beginntA !== beginntB) return beginntA - beginntB;
      // Als Zahl vergleichen, nicht als Text: sonst käme 10100 vor 10011.
      return Number(a.inventarnummer ?? 0) - Number(b.inventarnummer ?? 0);
    });
  }

  function leeren(): void {
    sammlung.value = [];
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
    sammlung,
    sammelt,
    sammle,
    entsammle,
    sammlungLeeren,
    gesammelteGeraete,
    ergaenzeStandort,
    ergaenzeLagerplatz,
    ergaenzeSchlagwort,
    entferneSchlagwort,
    nachId,
    plaetzeAmStandort,
    suche,
    leeren,
  };
});
