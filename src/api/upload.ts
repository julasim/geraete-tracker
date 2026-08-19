/**
 * Hochgeladene Dateien entgegennehmen und wieder ausliefern.
 *
 * Drei Regeln, die nicht verhandelbar sind:
 *
 * 1. Der Dateityp wird an den ERSTEN BYTES geprüft, nicht am Namen. Eine
 *    Datei "urlaub.jpg" kann alles Mögliche enthalten; die Endung ist eine
 *    Behauptung des Absenders.
 * 2. Der vom Benutzer gewählte Name landet NIE in einem Pfad. Gespeichert
 *    wird unter einer UUID — damit ist "../../etc/passwd" strukturell
 *    ausgeschlossen statt durch Filterregeln bekämpft.
 * 3. Der Ablageort liegt außerhalb des statisch ausgelieferten Ordners.
 *    Ausgeliefert wird nur über eine Route mit Anmeldeprüfung.
 */

import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_PATH, UPLOAD_MAX_BYTES } from "../config.js";
import { EingabeFehler, NichtGefunden } from "./fehler.js";

/** Erlaubte Typen, erkannt an ihrer Signatur. */
const SIGNATUREN: { mime: string; endung: string; pruefe: (b: Buffer) => boolean }[] = [
  {
    mime: "image/jpeg",
    endung: "jpg",
    pruefe: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: "image/png",
    endung: "png",
    pruefe: (b) =>
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    mime: "image/webp",
    endung: "webp",
    pruefe: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    mime: "application/pdf",
    endung: "pdf",
    pruefe: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-",
  },
];

export interface GespeicherteDatei {
  pfad: string; // relativ zu DATA_PATH
  mime: string;
  groesse: number;
  art: "foto" | "dokument";
}

/** Nimmt eine Datei entgegen, prüft sie und legt sie ab. */
export async function nimmDateiAn(
  datei: File,
  unterordner: string,
): Promise<GespeicherteDatei> {
  if (datei.size === 0) throw new EingabeFehler("Die Datei ist leer.");
  if (datei.size > UPLOAD_MAX_BYTES) {
    const grenzeMB = Math.round(UPLOAD_MAX_BYTES / 1024 / 1024);
    throw new EingabeFehler(
      `Die Datei ist zu groß (${(datei.size / 1024 / 1024).toFixed(1)} MB). ` +
        `Erlaubt sind bis zu ${grenzeMB} MB.`,
    );
  }

  const inhalt = Buffer.from(await datei.arrayBuffer());
  const erkannt = SIGNATUREN.find((s) => s.pruefe(inhalt));

  if (!erkannt) {
    throw new EingabeFehler(
      "Dieser Dateityp wird nicht angenommen. Erlaubt sind Bilder (JPG, PNG, WebP) und PDF.",
    );
  }

  // Name wird verworfen. Nur die Endung stammt aus der geprüften Signatur.
  const name = `${randomUUID()}.${erkannt.endung}`;
  const relativ = join(unterordner, name).replace(/\\/g, "/");
  const ziel = resolve(DATA_PATH, relativ);

  // Doppelter Boden: Selbst wenn der Unterordner je aus einer Eingabe käme,
  // darf das Ergebnis den Datenordner nicht verlassen.
  const wurzel = resolve(DATA_PATH);
  if (!ziel.startsWith(wurzel)) {
    throw new EingabeFehler("Ungültiger Ablageort.");
  }

  await mkdir(dirname(ziel), { recursive: true });
  await writeFile(ziel, inhalt);

  return {
    pfad: relativ,
    mime: erkannt.mime,
    groesse: inhalt.length,
    art: erkannt.mime === "application/pdf" ? "dokument" : "foto",
  };
}

/** Öffnet eine abgelegte Datei zum Ausliefern. */
export async function leseDatei(relativ: string): Promise<{
  strom: NodeJS.ReadableStream;
  groesse: number;
}> {
  const wurzel = resolve(DATA_PATH);
  const voll = resolve(wurzel, relativ);
  if (!voll.startsWith(wurzel)) throw new NichtGefunden("Datei");

  try {
    const angaben = await stat(voll);
    return { strom: createReadStream(voll), groesse: angaben.size };
  } catch {
    throw new NichtGefunden("Datei");
  }
}

export async function loescheDatei(relativ: string): Promise<void> {
  const wurzel = resolve(DATA_PATH);
  const voll = resolve(wurzel, relativ);
  if (!voll.startsWith(wurzel)) return;
  await unlink(voll).catch(() => {
    // Fehlt die Datei bereits, ist das Ziel erreicht.
  });
}
