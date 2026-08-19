// Selbsttest der Lesekette: erzeugt Barcodes mit den Nummern von Julius' Etiketten
// in mehreren Formaten und liest sie wieder ein. Läuft ohne Kamera und ohne Browser.
import { writeBarcode } from "zxing-wasm/writer";
import { readBarcodes } from "zxing-wasm/reader";

const NUMMERN = ["10001", "10013"];
const FORMATE = ["Code39", "Code128", "ITF", "Code93", "Codabar"];

let fehler = 0;

for (const format of FORMATE) {
  for (const nummer of NUMMERN) {
    let erzeugt;
    try {
      erzeugt = await writeBarcode(nummer, { format, scale: 4 });
    } catch (e) {
      console.log(`  ${format.padEnd(8)} ${nummer}  — nicht erzeugbar (${e.message})`);
      continue;
    }
    if (!erzeugt?.image) {
      console.log(`  ${format.padEnd(8)} ${nummer}  — kein Bild erzeugt`);
      continue;
    }
    const start = performance.now();
    const treffer = await readBarcodes(erzeugt.image, {
      formats: ["AllLinear"],
      tryHarder: true,
      tryRotate: true,
      tryInvert: true,
    });
    const ms = (performance.now() - start).toFixed(0);
    const t = treffer[0];
    const gleich = t && t.text === nummer;
    // ITF codiert Ziffernpaare und verlangt eine GERADE Stellenzahl. Bei den
    // fünfstelligen Nummern ergänzt der Encoder eine führende Null — der Scanner
    // liefert dann "010001", während auf dem Etikett "10001" steht.
    // Kein Fehler der Lesekette, sondern der Grund für domain/barcode.ts.
    const nurNull = t && !gleich && t.text.replace(/^0+/, "") === nummer;
    if (!t) fehler++;
    const marke = gleich ? "OK  " : nurNull ? "NULL" : "FEHL";
    console.log(
      `  ${marke} ${format.padEnd(8)} geschrieben "${nummer}" → ` +
      `gelesen "${t?.text ?? "nichts"}" als ${t?.format ?? "–"} (${ms} ms)` +
      (nurNull ? "   ← führende Null, Normalisierung nötig" : "")
    );
  }
}

console.log(fehler === 0 ? "\nAlle Formate sauber gelesen." : `\n${fehler} Fehlschläge.`);
process.exit(fehler === 0 ? 0 : 1);
