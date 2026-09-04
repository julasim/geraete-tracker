/**
 * Eine Baustelle anlegen, ohne den Buchungsvorgang zu verlassen.
 *
 * Der Fall aus der Praxis: Ein Auftrag ist neu, das Gerät steht schon auf dem
 * Hänger, und die Baustelle gibt es im System noch nicht. Wer dafür in die
 * Verwaltung wechseln müsste, bucht am Ende gar nicht oder auf den falschen
 * Ort — und dann stimmt der Bestand nicht mehr, was in dieser Anwendung der
 * teuerste Fehler überhaupt ist.
 *
 * Nur mit dem Recht `stammdaten.pflegen`; wer es nicht hat, sieht die Auswahl
 * wie bisher.
 *
 * Der neue Ort wird sofort **ausgewählt** — genau dorthin wollte der Benutzer
 * ja buchen. Deshalb nimmt das Composable die Zielauswahl entgegen und setzt
 * sie selbst; sonst müsste jeder Aufrufer daran denken, und einer vergisst es.
 *
 * **Was hier bewusst NICHT steht:** Die Escape-Taste. Im Dialog gehört sie
 * der offenen Eingabe (sonst kostet ein Tastendruck den ganzen ausgefüllten
 * Dialog), auf der Handy-Seite gibt es sie gar nicht. Das ist Hülle, nicht
 * Fachlichkeit.
 */
import { computed, nextTick, ref, type Ref } from "vue";
import { api, ApiError } from "@/api";
import { aehnlicherOrt } from "@/orte";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Standort } from "@/typen";

/**
 * @param gewaehlt  Die Zielauswahl des Formulars — sie wird auf den neuen Ort
 *                  gesetzt, sobald er steht.
 * @param fokussiere Was nach dem Aufklappen den Fokus bekommt. Bewusst als
 *                  Rückruf statt als zurückgegebener Template-Ref: Ein Ref,
 *                  den nur `ref="…"` im Template liest, gilt dem Übersetzer
 *                  als ungelesen — das Element bleibt deshalb beim Aufrufer.
 */
export function useNeueBaustelle(gewaehlt: Ref<string>, fokussiere?: () => void) {
  const bestand = useBestand();
  const anmeldung = useAnmeldung();

  const offen = ref(false);
  const name = ref("");
  const laeuft = ref(false);
  const fehler = ref<string | null>(null);

  const darfAnlegen = computed(() => anmeldung.darf("stammdaten.pflegen"));

  /** Warnt vor Dubletten, bevor gespeichert wird (siehe `orte.ts`). */
  const aehnlich = computed(() => aehnlicherOrt(name.value, bestand.standorte));

  async function zeigen(): Promise<void> {
    offen.value = true;
    fehler.value = null;
    await nextTick();
    fokussiere?.();
  }

  function schliessen(): void {
    offen.value = false;
  }

  async function anlegen(): Promise<void> {
    const getrimmt = name.value.trim();
    if (laeuft.value || !getrimmt) return;
    laeuft.value = true;
    fehler.value = null;

    try {
      const neu = await api.post<Standort>("/standorte", { name: getrimmt, typ: "baustelle" });
      bestand.ergaenzeStandort(neu);
      gewaehlt.value = neu.id;
      offen.value = false;
      name.value = "";
    } catch (f) {
      // Hier bewusst NICHT `meldungAus`: Nur der Server darf hier zu Wort
      // kommen („Es gibt bereits einen Ort mit diesem Namen"). Ein
      // Programmierfehler im Zweig darunter würde sonst als Satz über der
      // Eingabe landen.
      fehler.value =
        f instanceof ApiError
          ? f.message
          : "Die Baustelle konnte nicht angelegt werden. Bitte noch einmal versuchen.";
    } finally {
      laeuft.value = false;
    }
  }

  return { offen, name, laeuft, fehler, darfAnlegen, aehnlich, zeigen, schliessen, anlegen };
}
