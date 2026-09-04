/**
 * Welches Zubehör mitfährt — die Löffel zum Bagger.
 *
 * Vorangehakt, weil es der Regelfall ist: Wer den Bagger ausgibt, lädt die
 * Löffel mit auf. Ohne diesen Vorschlag stünden sie im System weiter im
 * Lager, und der Bestand wäre falsch. Manchmal bleibt der Löffel aber da —
 * deshalb abwählbar, nicht erzwungen.
 *
 * ── Warum die Abwahl und nicht die Wahl gemerkt wird ──────────────────────
 *
 * Bis AP25 stand die Auswahl als Liste der gewählten Kennungen da, und jedes
 * Neuladen setzte sie bedingungslos auf **alle** zurück. Das Neuladen hängt
 * aber an der Sammlung: Wer den Hydraulikhammer abwählte und danach ein
 * weiteres Gerät in die Liste nahm, hatte den Hammer wieder angehakt — und
 * buchte ihn hinaus. Am Computer der wahrscheinlichere Fall, weil die Tabelle
 * danebensteht und man zwischendurch weiterklickt.
 *
 * Gemerkt wird deshalb die **Abwahl**: eine ausdrückliche Entscheidung des
 * Benutzers, die kein Neuladen zurücknehmen darf. Sie überlebt auch, wenn das
 * zugehörige Gerät kurz aus der Sammlung fliegt und wiederkommt — wer den
 * Hammer einmal dagelassen hat, will ihn nicht beim nächsten Klick wieder auf
 * dem Hänger haben.
 *
 * ── Warum nach Zustand gefiltert wird ─────────────────────────────────────
 *
 * `zubehoerVon` (`src/data/pakete.ts`) liefert alles, was nicht ausgemustert
 * ist — auch ein Teil, das im Lager geblieben ist. Bei einer Rücknahme lässt
 * der Zustandsautomat aber nur `ausgegeben` zu (`src/domain/status.ts`), und
 * die Sammelbuchung ist alles oder nichts: Ein einziger Löffel im Regal
 * ließe die ganze Rücknahme scheitern, mit einer Meldung über ein Teil, das
 * der Benutzer nie angefasst hat. Angeboten wird deshalb nur, was in dieser
 * Buchungsart überhaupt buchbar ist.
 */
import { computed, ref } from "vue";
import { api } from "@/api";
import type { Buchungsart, GeraetStatus, PaketGeraet } from "@/typen";

/**
 * Aus welchen Zuständen heraus eine Buchungsart zulässig ist. Zweitschrift
 * von `ERLAUBT` in `src/domain/status.ts` — der Server bleibt die Instanz,
 * die es durchsetzt; hier geht es nur darum, nichts anzubieten, was er
 * ablehnen muss.
 */
export const BUCHBAR: Record<string, GeraetStatus[]> = {
  ausgabe: ["verfuegbar"],
  ruecknahme: ["ausgegeben"],
  umbuchung: ["ausgegeben"],
};

export function useZubehoerwahl(geraetIds: () => string[], art: () => Buchungsart = () => "ausgabe") {
  const zubehoer = ref<PaketGeraet[]>([]);
  /** Die ausdrücklich abgewählten Kennungen. Sie überleben jedes Neuladen. */
  const abgewaehlt = ref(new Set<string>());

  const gewaehlt = computed(() =>
    zubehoer.value.filter((z) => !abgewaehlt.value.has(z.id)).map((z) => z.id),
  );

  const istGewaehlt = (id: string): boolean => !abgewaehlt.value.has(id);

  function umschalten(id: string): void {
    if (abgewaehlt.value.has(id)) abgewaehlt.value.delete(id);
    else abgewaehlt.value.add(id);
  }

  /**
   * Ein einzelnes Teil abwählen, ohne umzuschalten.
   *
   * Für den Weg, auf dem der Server ein Zubehörteil in seiner Fehlermeldung
   * beim Namen nennt: Es muss aus der Auswahl, und zwar so, dass der nächste
   * Ladevorgang es nicht wieder anhakt.
   */
  function abwaehlen(id: string): void {
    abgewaehlt.value.add(id);
  }

  async function laden(): Promise<void> {
    const ids = [...geraetIds()];
    if (!ids.length) {
      zubehoer.value = [];
      return;
    }

    // Je Gerät einzeln, aber parallel: Es sind wenige Aufrufe, und die Route
    // gibt es bereits. Der Fang sitzt AM EINZELNEN Aufruf — fällt einer aus,
    // fehlt sein Zubehör, nicht das aller anderen.
    const listen = await Promise.all(
      ids.map((id) => api.get<PaketGeraet[]>(`/geraete/${id}/zubehoer`).catch(() => [])),
    );

    // Was selbst schon gesammelt ist, nicht doppelt anbieten: Ein Teil kann
    // Zubehör des einen und eigenständig gewählt sein.
    const gesehen = new Set(ids);
    const flach: PaketGeraet[] = [];
    for (const z of listen.flat()) {
      if (!z || gesehen.has(z.id)) continue;
      gesehen.add(z.id);
      flach.push(z);
    }

    const erlaubt = BUCHBAR[art()];
    zubehoer.value = erlaubt ? flach.filter((z) => erlaubt.includes(z.status)) : flach;
  }

  return { zubehoer, gewaehlt, istGewaehlt, umschalten, abwaehlen, laden };
}
