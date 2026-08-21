/**
 * Etikettenbögen als PDF.
 *
 * Die vier Punkte, an denen selbst gestaltete Barcode-Etiketten in der
 * Praxis scheitern — und wie sie hier behandelt werden:
 *
 * 1. RUHEZONE. Code 128 braucht links und rechts eine freie Fläche von
 *    mindestens dem Zehnfachen der schmalsten Strichbreite. Fehlt sie,
 *    findet der Leser den Anfang des Codes nicht. Sie ist hier fest
 *    eingeplant und nicht dem Zufall des Seitenrands überlassen.
 *
 * 2. STRICHBREITE. Mindestens 0,33 mm bei Laserdruck. Darunter verschmieren
 *    die Striche, und die Kamera liest nichts mehr.
 *
 * 3. DRUCKSKALIERUNG. Der Standardfall im Browser ist "an Seite anpassen",
 *    und damit schrumpft alles um 3 bis 5 %. Deshalb wird das PDF exakt in
 *    A4 mit echten Millimeter-Maßen erzeugt, und die Oberfläche weist auf
 *    die Druckeinstellung hin.
 *
 * 4. PRÜFZIFFER. Code 128 trägt sie im Symbol; bwip-js erzeugt sie selbst.
 *    Halb gelesene Codes werden dadurch verworfen statt falsch gedeutet.
 */

import { toBuffer } from "bwip-js/node";
import PDFDocument from "pdfkit";

/** Millimeter in Punkte (72 dpi) — die Maßeinheit von PDF. */
const mm = (wert: number) => (wert * 72) / 25.4;

export interface Etikettenformat {
  name: string;
  seiteBreite: number;
  seiteHoehe: number;
  spalten: number;
  reihen: number;
  breite: number;
  hoehe: number;
  randOben: number;
  randLinks: number;
  abstandX: number;
  abstandY: number;
}

/**
 * Gängige Bögen. Die Maße stammen von den Herstellerangaben; wer ein
 * anderes Fabrikat verwendet, ergänzt hier einen Eintrag — sonst ändert
 * sich nichts.
 */
export const FORMATE: Record<string, Etikettenformat> = {
  "70x37": {
    name: "70 × 37 mm, 24 je Bogen (Avery 3474 / Herma 4630)",
    seiteBreite: 210,
    seiteHoehe: 297,
    spalten: 3,
    reihen: 8,
    breite: 70,
    hoehe: 37,
    randOben: 0,
    randLinks: 0,
    abstandX: 0,
    abstandY: 0,
  },
  "63x38": {
    name: "63,5 × 38,1 mm, 21 je Bogen (Avery 3652)",
    seiteBreite: 210,
    seiteHoehe: 297,
    spalten: 3,
    reihen: 7,
    breite: 63.5,
    hoehe: 38.1,
    randOben: 15.1,
    randLinks: 7.2,
    abstandX: 2.5,
    abstandY: 0,
  },
  "48x25": {
    name: "48,5 × 25,4 mm, 40 je Bogen (Avery 3658)",
    seiteBreite: 210,
    seiteHoehe: 297,
    spalten: 4,
    reihen: 10,
    breite: 48.5,
    hoehe: 25.4,
    randOben: 21.5,
    randLinks: 8,
    abstandX: 0,
    abstandY: 0,
  },
};

/**
 * Auf dem Etikett stehen Barcode, Nummer im Klartext und der Firmenname —
 * mehr nicht.
 *
 * Es gab einmal ein Feld für die Gerätebezeichnung. Gezeichnet wurde es nie,
 * obwohl der Kommentar daneben das behauptete und alle Aufrufer es brav
 * mitgaben. Entfernt, statt es nachzurüsten: Bei 37 mm Höhe ginge eine
 * weitere Zeile nur auf Kosten der Barcode-Höhe oder der Ruhezone — und
 * beides entscheidet darüber, ob sich das Etikett später scannen lässt.
 */
export interface Etikett {
  code: string;
}

export interface BogenOptionen {
  format?: keyof typeof FORMATE;
  firmenname?: string;
  /** Wo auf dem Bogen begonnen wird — für teilweise verbrauchte Bögen. */
  startPosition?: number;
}

/** Die kleinste Strichbreite. Weniger verträgt kein Laserdruck. */
const MIN_STRICHBREITE_MM = 0.33;

/**
 * Erzeugt den Barcode als Bild.
 *
 * `bwip-js` rechnet in Modulen: `scale` ist die Anzahl Bildpunkte je Strich.
 * Bei 300 dpi entspricht ein Punkt 0,085 mm — für 0,33 mm braucht es also
 * mindestens Faktor 4.
 */
async function barcodeBild(code: string): Promise<Buffer> {
  return toBuffer({
    bcid: "code128",
    text: code,
    scale: 4,
    height: 10, // in Modulen; die Höhe wird beim Platzieren skaliert
    includetext: false, // die Nummer setzen wir selbst, in lesbarer Schrift
    paddingwidth: 0, // die Ruhezone kommt aus dem Layout, siehe unten
    paddingheight: 0,
  });
}

export async function baueBogen(
  etiketten: Etikett[],
  optionen: BogenOptionen = {},
): Promise<Buffer> {
  const format = FORMATE[optionen.format ?? "70x37"] ?? FORMATE["70x37"]!;
  const firmenname = optionen.firmenname ?? "";
  const start = Math.max(0, optionen.startPosition ?? 0);

  const dokument = new PDFDocument({
    // Feste Maße, keine Voreinstellung: Nur so bleibt der Barcode maßhaltig.
    size: [mm(format.seiteBreite), mm(format.seiteHoehe)],
    margin: 0,
    info: { Title: "Geräte-Etiketten", Creator: "Geräte-Tracker" },
  });

  const stuecke: Buffer[] = [];
  dokument.on("data", (s: Buffer) => stuecke.push(s));
  const fertig = new Promise<Buffer>((f) => dokument.on("end", () => f(Buffer.concat(stuecke))));

  const proSeite = format.spalten * format.reihen;
  // Vorab erzeugen: PDFKit arbeitet synchron, die Bilderzeugung nicht.
  const bilder = await Promise.all(etiketten.map((e) => barcodeBild(e.code)));

  let position = start;
  let erstesAufSeite = true;

  for (let i = 0; i < etiketten.length; i++) {
    if (position >= proSeite) {
      dokument.addPage();
      position = 0;
      erstesAufSeite = true;
    }
    if (!erstesAufSeite || i === 0) {
      // nichts zu tun — nur der Lesbarkeit halber
    }
    erstesAufSeite = false;

    const spalte = position % format.spalten;
    const reihe = Math.floor(position / format.spalten);

    const x = mm(format.randLinks + spalte * (format.breite + format.abstandX));
    const y = mm(format.randOben + reihe * (format.hoehe + format.abstandY));

    zeichneEtikett(dokument, {
      x,
      y,
      breite: mm(format.breite),
      hoehe: mm(format.hoehe),
      bild: bilder[i]!,
      etikett: etiketten[i]!,
      firmenname,
    });

    position++;
  }

  dokument.end();
  return fertig;
}

interface ZeichenAuftrag {
  x: number;
  y: number;
  breite: number;
  hoehe: number;
  bild: Buffer;
  etikett: Etikett;
  firmenname: string;
}

function zeichneEtikett(dokument: PDFKit.PDFDocument, auftrag: ZeichenAuftrag): void {
  const { x, y, breite, hoehe, bild, etikett, firmenname } = auftrag;

  // Die Ruhezone: links und rechts mindestens das Zehnfache der
  // Strichbreite freihalten. Ohne sie findet der Leser den Codeanfang nicht —
  // der häufigste Fehler bei selbst gestalteten Etiketten.
  const ruhezone = mm(MIN_STRICHBREITE_MM * 10);
  const innenBreite = breite - 2 * ruhezone;

  const nummerHoehe = mm(6);
  const firmaHoehe = firmenname ? mm(3.5) : 0;
  const luft = mm(2);

  const codeHoehe = Math.max(mm(8), hoehe - nummerHoehe - firmaHoehe - 3 * luft);

  dokument.image(bild, x + ruhezone, y + luft, {
    width: innenBreite,
    height: codeHoehe,
  });

  // Die Nummer im Klartext. Wird der Barcode unleserlich, tippt man sie ein —
  // deshalb groß und gut lesbar, nicht als Beiwerk.
  dokument
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor("#000000")
    .text(etikett.code, x, y + luft + codeHoehe + mm(1), {
      width: breite,
      align: "center",
      lineBreak: false,
    });

  if (firmenname) {
    dokument
      .font("Helvetica")
      .fontSize(6)
      .fillColor("#444444")
      .text(firmenname, x, y + hoehe - firmaHoehe - mm(1.2), {
        width: breite,
        align: "center",
        lineBreak: false,
      });
  }
}

/**
 * Ein Testbogen mit vier Etiketten.
 *
 * Der wird gedruckt, ausgeschnitten, aufgeklebt und mit der App gescannt —
 * BEVOR 200 Stück entstehen. Ein Etikett, das die Kamera nicht liest, merkt
 * man sonst erst, wenn alle kleben.
 */
export async function baueTestbogen(optionen: BogenOptionen = {}): Promise<Buffer> {
  return baueBogen(
    [
      { code: "10001" },
      { code: "10002" },
      { code: "99998" },
      { code: "99999" },
    ],
    optionen,
  );
}
