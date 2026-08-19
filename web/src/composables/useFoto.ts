/**
 * Fotos aufnehmen und vor dem Hochladen verkleinern.
 *
 * Ein Handyfoto hat heute leicht 4 bis 8 MB. Zum Erkennen eines Geräts oder
 * eines Schadens genügt ein Bruchteil davon. Verkleinert wird deshalb im
 * BROWSER, bevor etwas über die Leitung geht:
 *
 *   * spart Mobilfunkdaten der Mitarbeiter — auf der Baustelle oft die
 *     knappste Ressource
 *   * spart Platz auf dem Mini-PC
 *   * erspart dem Server eine native Bildbibliothek (sharp), die im
 *     Docker-Bau jedes Mal übersetzt werden müsste
 */

import { ref } from "vue";

/** Längste Kante nach dem Verkleinern. Reicht, um Typenschilder zu lesen. */
const MAX_KANTE = 1600;
const GUETE = 0.82;

export interface FotoErgebnis {
  datei: File;
  vorschau: string;
  vorher: number;
  nachher: number;
}

export function useFoto() {
  const arbeitet = ref(false);
  const fehler = ref<string | null>(null);

  /**
   * Verkleinert ein Bild. PDFs und alles Nicht-Bildliche gehen unverändert
   * durch — ein Prüfprotokoll darf nicht durch eine Bildbearbeitung laufen.
   */
  async function vorbereiten(roh: File): Promise<FotoErgebnis> {
    arbeitet.value = true;
    fehler.value = null;
    try {
      if (!roh.type.startsWith("image/")) {
        return { datei: roh, vorschau: "", vorher: roh.size, nachher: roh.size };
      }

      const bild = await ladeBild(roh);
      const faktor = Math.min(1, MAX_KANTE / Math.max(bild.width, bild.height));

      // Ist das Bild ohnehin klein genug, wird nichts neu gerechnet —
      // ein zweiter Durchgang durch JPEG kostet nur Qualität.
      if (faktor >= 1 && roh.size < 900_000) {
        return {
          datei: roh,
          vorschau: URL.createObjectURL(roh),
          vorher: roh.size,
          nachher: roh.size,
        };
      }

      const leinwand = document.createElement("canvas");
      leinwand.width = Math.round(bild.width * faktor);
      leinwand.height = Math.round(bild.height * faktor);

      const stift = leinwand.getContext("2d");
      if (!stift) throw new Error("Das Bild lässt sich nicht verarbeiten.");
      stift.drawImage(bild, 0, 0, leinwand.width, leinwand.height);

      const brocken = await new Promise<Blob | null>((fertig) =>
        leinwand.toBlob(fertig, "image/jpeg", GUETE),
      );
      if (!brocken) throw new Error("Das Bild lässt sich nicht verkleinern.");

      const name = roh.name.replace(/\.[^.]+$/, "") + ".jpg";
      const datei = new File([brocken], name, { type: "image/jpeg" });

      return {
        datei,
        vorschau: URL.createObjectURL(brocken),
        vorher: roh.size,
        nachher: datei.size,
      };
    } catch (f) {
      fehler.value = f instanceof Error ? f.message : "Das Bild konnte nicht gelesen werden.";
      throw f;
    } finally {
      arbeitet.value = false;
    }
  }

  return { arbeitet, fehler, vorbereiten };
}

function ladeBild(datei: File): Promise<HTMLImageElement> {
  return new Promise((fertig, schief) => {
    const url = URL.createObjectURL(datei);
    const bild = new Image();
    bild.onload = () => {
      // Die Adresse wieder freigeben, sonst hält der Browser das Bild im
      // Speicher, bis die Seite neu geladen wird.
      URL.revokeObjectURL(url);
      fertig(bild);
    };
    bild.onerror = () => {
      URL.revokeObjectURL(url);
      schief(new Error("Die Datei ist kein lesbares Bild."));
    };
    bild.src = url;
  });
}

/** Lesbare Größenangabe. */
export function groesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
