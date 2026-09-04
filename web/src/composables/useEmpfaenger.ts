/**
 * Wer das Gerät übernimmt.
 *
 * `GET /benutzer` antwortet in zwei Ausprägungen: Ohne das Recht
 * `benutzer.verwalten` kommen nur Kennung, Name und Zustand. Jeder braucht
 * die Namensliste, sonst ließe sich nichts auf jemanden buchen.
 *
 * **Der Ausfall dieser Route darf das Formular nicht kosten.** In
 * `BuchenView` stand der Aufruf bis AP25 im gemeinsamen `try` des
 * Ladevorgangs: Antwortete die Route nicht, sah der Benutzer eine
 * Fehlermeldung statt des Formulars — obwohl der Weg „Fremdfirma ohne Konto"
 * gar keine Namensliste braucht. Die drei anderen Fassungen fingen es ab.
 *
 * **`ersterAlsRueckfall` bleibt eine Wahl des Aufrufers.** `empfaenger_id`
 * landet in einer unveränderlichen Zeile (`src/data/buchungen.ts`), auch bei
 * einer Rücknahme, wo das Feld gar nicht sichtbar ist. Ein fremder Name
 * darin ist nur noch per Gegenbuchung zu berichtigen. Die Sammelwege tragen
 * den Rückfall seit AP23, die Einzelwege nicht — das bleibt so, bis jemand
 * es ausdrücklich entscheidet.
 */
import { computed, ref } from "vue";
import { api } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";

export interface EmpfaengerOptionen {
  /**
   * Wird die Liste überhaupt gebraucht? `SammelBuchenView` lädt sie bei einer
   * Rücknahme bewusst nicht — dort gibt es kein Empfängerfeld.
   */
  wenn?: () => boolean;
  /** Niemand angemeldet? Dann den ersten Namen nehmen (nur die Sammelwege). */
  ersterAlsRueckfall?: boolean;
}

export function useEmpfaenger(optionen: EmpfaengerOptionen = {}) {
  const anmeldung = useAnmeldung();

  const personen = ref<{ id: string; anzeigename: string }[]>([]);
  const empfaengerId = ref("");
  const empfaengerFrei = ref("");
  const fremdfirma = ref(false);

  async function laden(): Promise<void> {
    if (optionen.wenn && !optionen.wenn()) return;
    try {
      personen.value = await api.get<{ id: string; anzeigename: string }[]>("/benutzer");
    } catch {
      // Ohne Personenliste bleibt der Freitext — buchen muss trotzdem gehen.
    }
    const rueckfall = optionen.ersterAlsRueckfall ? (personen.value[0]?.id ?? "") : "";
    empfaengerId.value = anmeldung.benutzer?.id ?? rueckfall;
  }

  /** Was in den Buchungskörper geht: entweder Konto oder Freitext, nie beides. */
  const empfaengerFelder = computed(() => ({
    empfaenger_id: fremdfirma.value ? null : empfaengerId.value || null,
    empfaenger_freitext: fremdfirma.value ? empfaengerFrei.value : null,
  }));

  return { personen, empfaengerId, empfaengerFrei, fremdfirma, empfaengerFelder, laden };
}
