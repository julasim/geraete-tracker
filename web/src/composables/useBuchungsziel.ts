/**
 * Wohin gebucht wird: Ort und Lagerplatz.
 *
 * Zwei Regeln, die an allen vier Buchungsstellen gelten sollen und es vorher
 * an keiner vollständig taten:
 *
 * 1. **Vorbelegt mit dem zuletzt gewählten Ort.** Wer im Bauhof zehn Geräte
 *    auf dieselbe Baustelle gibt, soll das Ziel einmal wählen, nicht zehnmal.
 *    Der Schlüssel steht in `merken.ts`, damit Handy und Computer dasselbe
 *    Gedächtnis benutzen.
 *
 * 2. **Der Lagerplatz gehört zum Ort.** Wird der Ort gewechselt, ist der
 *    bisherige Platz gegenstandslos — er liegt im alten Regal. Bis AP25 blieb
 *    er in **allen vier** Fassungen stehen: Der Server wies die Buchung mit
 *    409 ab, während das Formular richtig aussah und die Auswahl nur leer
 *    anzeigte. Eine Zeile, die viermal fehlte.
 *
 * Die Vorbelegung hängt am `watch` auf die möglichen Ziele, nicht an
 * `onMounted`: `SammelPanel` ruft `bestand.laden()` nie, es verlässt sich
 * darauf, dass `GeraeteView` den Bestand schon geholt hat. Kommt der Bestand
 * später, muss die Vorbelegung trotzdem greifen — sonst steht dort „—".
 */
import { computed, ref, watch } from "vue";
import { letzterOrt } from "@/merken";
import { useBestand } from "@/stores/bestand";
import type { Buchungsart } from "@/typen";

export function useBuchungsziel(art: () => Buchungsart) {
  const bestand = useBestand();

  const standortId = ref("");
  const lagerplatzId = ref("");

  /** Ins Lager wird zurückgenommen, hinaus geht es an alles außer Lager. */
  const zielOrte = computed(() =>
    art() === "ruecknahme"
      ? bestand.lager
      : bestand.aktiveStandorte.filter((s) => s.typ !== "lager"),
  );

  const plaetze = computed(() =>
    standortId.value ? bestand.plaetzeAmStandort(standortId.value) : [],
  );

  watch(
    zielOrte,
    (orte) => {
      // Eine gültige Wahl des Benutzers bleibt unangetastet — sonst würde ihm
      // das Anlegen einer Baustelle seine eigene Auswahl wieder wegnehmen.
      if (standortId.value && orte.some((s) => s.id === standortId.value)) return;
      const gemerkt = localStorage.getItem(letzterOrt(art()));
      const passt = !!gemerkt && orte.some((s) => s.id === gemerkt);
      standortId.value = passt && gemerkt ? gemerkt : (orte[0]?.id ?? "");
    },
    { immediate: true },
  );

  watch(standortId, () => {
    lagerplatzId.value = "";
  });

  /** Nach einer erfolgreichen Buchung: Das Ziel für das nächste Mal merken. */
  function merke(): void {
    localStorage.setItem(letzterOrt(art()), standortId.value);
  }

  return { standortId, lagerplatzId, zielOrte, plaetze, merke };
}
