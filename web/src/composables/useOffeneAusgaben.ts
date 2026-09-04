/**
 * Wie lange ein Gerät schon draußen ist.
 *
 * Das steht **nicht** am Gerät: Standort, Nutzer und damit auch die Dauer
 * ergeben sich in dieser Anwendung ausschließlich aus Buchungen. Ein Feld
 * „seit" am Datensatz wäre eine zweite Wahrheit, die beim ersten
 * nachgetragenen Beleg von der ersten abweicht.
 *
 * `GET /buchungen/offen` beantwortet die Frage für den ganzen Bestand in
 * einem Aufruf — eine Abfrage je Zeile wären bei 200 Geräten 200 Aufrufe.
 *
 * Angelegt, als Tabelle und Kartenliste denselben Block Wort für Wort
 * doppelt trugen. Die beiden sind nie zugleich im Bild, es bleibt also auch
 * jetzt bei einem Aufruf.
 */
import { onMounted, ref, type Ref } from "vue";
import { api } from "@/api";
import type { OffeneAusgabe } from "@/typen";

export interface Draussen {
  tage: number;
  ueberfaellig: boolean;
}

export function useOffeneAusgaben(): { draussen: Ref<Map<string, Draussen>> } {
  const draussen = ref(new Map<string, Draussen>());

  onMounted(async () => {
    try {
      const liste = await api.get<OffeneAusgabe[]>("/buchungen/offen");
      draussen.value = new Map(
        liste.map((o) => [o.geraet_id, { tage: o.tage, ueberfaellig: o.ueberfaellig }]),
      );
    } catch {
      // Ohne die Liste bleibt die Dauer leer. Ein Strich ist ehrlicher als
      // eine Zahl aus einer Quelle, die gerade nicht antwortet.
    }
  });

  return { draussen };
}
