/**
 * Ein Foto vom Zustand bei der Übergabe.
 *
 * Der Fall, für den es gedacht ist: Ein Gerät kommt beschädigt zurück, und
 * niemand kann belegen, wie es hinausging — bei Fremdfirmen der klassische
 * Streitpunkt. Das Bild hängt an der BUCHUNG, nicht am Gerät: Es dokumentiert
 * einen Zeitpunkt, keinen Dauerzustand.
 *
 * Freiwillig. Wer im Regen am Hänger steht, soll nicht fotografieren müssen.
 *
 * **Reihenfolge und Fehlerfall sind Absicht:** Das Bild geht NACH der Buchung
 * hinaus (es hängt an ihr, also muss sie zuerst existieren), und ein
 * gescheiterter Upload wirft die Buchung nicht um — der Bestand ist die
 * Hauptsache, das Bild eine Beigabe. Deshalb setzt `hochladen()` nur
 * `warnung` und wirft nie.
 *
 * **Das Feld gehört hinter `dateien.hochladen`.** Ohne das Recht ging die
 * Buchung zwar durch, das Bild scheiterte aber mit „Die Buchung ist
 * gespeichert, das Foto konnte nicht übertragen werden." — der Grund stand
 * nirgends, und der Benutzer hatte im Regen umsonst fotografiert.
 */
import { computed, ref } from "vue";
import { useFoto } from "@/composables/useFoto";
import { useAnmeldung } from "@/stores/anmeldung";

export function useZustandsfoto(geraetId: () => string) {
  // Absichtlich hier und nicht beim Aufrufer: Beide Ansichten mocken in ihren
  // Tests `@/composables/useFoto`. Läge der Aufruf draußen, prüften sie die
  // Verkleinerung mit, die sie gerade wegmocken wollen.
  const foto = useFoto();
  const anmeldung = useAnmeldung();

  const datei = ref<File | null>(null);
  const vorschau = ref<string | null>(null);
  const warnung = ref<string | null>(null);
  /*
   * Nur der gescheiterte Upload, nicht die gescheiterte Vorbereitung.
   *
   * Beide setzen `warnung`, aber sie bedeuten Verschiedenes: Die
   * Vorbereitung scheitert VOR der Buchung und kostet nichts — man wählt ein
   * anderes Bild oder lässt es. Der Upload scheitert NACH der Buchung; dort
   * ist wirklich etwas verloren, und der Dialog soll offen bleiben, damit die
   * Meldung nicht mit ihm verschwindet. Ohne diese Unterscheidung hielt eine
   * misslungene Bildvorbereitung den Dialog nach einer vollständig geglückten
   * Buchung offen, obwohl gar kein Upload stattgefunden hatte.
   */
  const uebertragungFehlt = ref(false);

  const darfHochladen = computed(() => anmeldung.darf("dateien.hochladen"));

  async function waehlen(ereignis: Event): Promise<void> {
    const roh = (ereignis.target as HTMLInputElement).files?.[0];
    if (!roh) return;
    try {
      const fertig = await foto.vorbereiten(roh);
      datei.value = fertig.datei;
      vorschau.value = fertig.vorschau;
      warnung.value = null;
    } catch {
      warnung.value = "Das Bild konnte nicht vorbereitet werden.";
    }
  }

  function verwerfen(): void {
    datei.value = null;
    vorschau.value = null;
    // Auch die Meldung. Scheitert die Vorbereitung, gibt es keine Vorschau —
    // und damit hing der Verwerfen-Knopf, der einzige Weg zurück, an einem
    // Element, das gar nicht erschien. Die Meldung blieb für immer stehen.
    warnung.value = null;
  }

  /**
   * Direkt über `fetch`, nicht über `api`: Ein Upload geht als `FormData`
   * hinaus, `api.post` setzt `Content-Type: application/json`.
   */
  async function hochladen(buchungId: string): Promise<void> {
    if (!datei.value) return;
    const formular = new FormData();
    formular.append("datei", datei.value);
    formular.append("buchung_id", buchungId);
    try {
      const antwort = await fetch(`/api/geraete/${geraetId()}/dateien`, {
        method: "POST",
        body: formular,
        credentials: "same-origin",
      });
      if (!antwort.ok) throw new Error();
    } catch {
      // Die Buchung steht bereits — das darf sie nicht mehr umwerfen.
      warnung.value = "Die Buchung ist gespeichert, das Foto konnte nicht übertragen werden.";
      uebertragungFehlt.value = true;
    }
  }

  return {
    foto,
    datei,
    vorschau,
    warnung,
    uebertragungFehlt,
    darfHochladen,
    waehlen,
    verwerfen,
    hochladen,
  };
}
