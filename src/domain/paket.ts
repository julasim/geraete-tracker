/**
 * ZIP-Paket für den vollständigen Bestandsaustausch: CSV + Bilder.
 *
 * Paketstruktur:
 *   geraete.csv              — der Bestand (Semikolon, BOM)
 *   bilder/<inventarnummer>/  — Fotos und Dokumente je Gerät
 *
 * Reine Funktionen, ohne Datenbank und ohne HTTP.
 */

import AdmZip from "adm-zip";

export interface EntpacktesBild {
  /** Dateiname im ZIP (z.B. "foto1.jpg"). */
  dateiname: string;
  /** Rohdaten. */
  inhalt: Buffer;
}

export interface EntpacktesPaket {
  /** Die CSV-Daten als Bytes (für leseCsv). */
  csv: Uint8Array;
  /** Bilder je Inventarnummer. */
  bilder: Map<string, EntpacktesBild[]>;
}

export interface BilderZusammenfassung {
  /** Wie viele Geräte haben Bilder im Paket? */
  geraete: number;
  /** Wie viele Dateien insgesamt? */
  dateien: number;
}

const ERLAUBTE_ENDUNGEN = new Set(["jpg", "jpeg", "png", "webp", "pdf"]);

/**
 * Entpackt ein ZIP-Paket in CSV und Bilderordner.
 *
 * Die CSV-Datei wird im Wurzelverzeichnis gesucht — die erste .csv-Datei,
 * die dort liegt. Bilder liegen unter bilder/<inventarnummer>/.
 */
export function entpackePaket(zipPuffer: Buffer): EntpacktesPaket {
  const zip = new AdmZip(zipPuffer);
  const eintraege = zip.getEntries();

  let csv: Uint8Array | null = null;
  const bilder = new Map<string, EntpacktesBild[]>();

  for (const eintrag of eintraege) {
    if (eintrag.isDirectory) continue;
    const pfad = eintrag.entryName.replace(/\\/g, "/");

    // CSV im Wurzelverzeichnis
    if (!pfad.includes("/") && pfad.toLowerCase().endsWith(".csv")) {
      if (!csv) csv = new Uint8Array(eintrag.getData());
      continue;
    }

    // Bilder unter bilder/<inventarnummer>/<dateiname>
    const teile = pfad.split("/");
    if (teile.length >= 3 && teile[0]!.toLowerCase() === "bilder") {
      const invNr = teile[1]!;
      const dateiname = teile.slice(2).join("/");
      const endung = dateiname.split(".").pop()?.toLowerCase() ?? "";

      if (!ERLAUBTE_ENDUNGEN.has(endung)) continue;

      if (!bilder.has(invNr)) bilder.set(invNr, []);
      bilder.get(invNr)!.push({
        dateiname,
        inhalt: eintrag.getData(),
      });
    }
  }

  if (!csv) {
    throw new Error(
      "Das ZIP-Paket enthält keine CSV-Datei im Wurzelverzeichnis. " +
        "Erwartet wird eine Datei mit der Endung .csv direkt im Paket.",
    );
  }

  return { csv, bilder };
}

export function bilderZusammenfassung(bilder: Map<string, EntpacktesBild[]>): BilderZusammenfassung {
  let dateien = 0;
  for (const liste of bilder.values()) dateien += liste.length;
  return { geraete: bilder.size, dateien };
}

/**
 * Baut ein ZIP-Paket aus CSV und Bildern.
 *
 * Die Bilder werden als Buffer-Paare (pfad, inhalt) übergeben,
 * damit die Funktion rein bleibt und nicht selbst Dateien liest.
 */
export function bauePaket(
  csv: string,
  bilder: { inventarnummer: string; dateiname: string; inhalt: Buffer }[],
): Buffer {
  const zip = new AdmZip();

  zip.addFile("geraete.csv", Buffer.from(csv, "utf-8"));

  for (const bild of bilder) {
    const pfad = `bilder/${bild.inventarnummer}/${bild.dateiname}`;
    zip.addFile(pfad, bild.inhalt);
  }

  return zip.toBuffer();
}
