/**
 * Der Barcode-Leser. Die einzige Stelle, die von Kameras weiß.
 *
 * Zwei Wege hinter einer Fassade:
 *   * `BarcodeDetector` — nativ, schnell, sparsam. Gibt es auf Android und
 *     in Chrome, auf iPhone und iPad NICHT.
 *   * `zxing-wasm` — läuft überall, wird lokal gebündelt statt von einem
 *     CDN geladen (die Anwendung soll ohne Außenkontakt auskommen).
 *
 * Die Etiketten sind Code 128, fünfstellig — in AP1 bestimmt. Der Leser
 * sucht deshalb genau dieses eine Format: schneller, und kein anderes
 * Format kann fälschlich anspringen.
 */

import { onScopeDispose, readonly, ref, shallowRef } from "vue";

export type ScanQuelle = "kamera" | "hand" | "hardware";
export type ScannerZustand =
  | "aus"
  | "startet"
  | "laeuft"
  | "kein_zugriff"
  | "nicht_unterstuetzt"
  | "kein_geraet";

export interface ScanTreffer {
  code: string;
  quelle: ScanQuelle;
  format?: string;
}

/** ~10 Bilder je Sekunde. Mehr bringt nichts und heizt das Telefon. */
const TAKT_MS = 100;

export function useScanner() {
  const zustand = ref<ScannerZustand>("aus");
  const fehlertext = ref<string | null>(null);
  const lichtMoeglich = ref(false);
  const lichtAn = ref(false);
  const laeuftSeitMs = ref(0);

  const video = shallowRef<HTMLVideoElement | null>(null);
  let strom: MediaStream | null = null;
  let schleife: number | null = null;
  let angehalten = false;
  let start = 0;

  const leinwand = document.createElement("canvas");
  const stift = leinwand.getContext("2d", { willReadFrequently: true });

  let nativerLeser: { detect(quelle: CanvasImageSource): Promise<{ rawValue: string; format: string }[]> } | null =
    null;
  let zxing: typeof import("zxing-wasm/reader") | null = null;

  const zuhoerer: ((treffer: ScanTreffer) => void)[] = [];
  const beiTreffer = (fn: (treffer: ScanTreffer) => void) => zuhoerer.push(fn);

  /**
   * Ein Code gilt erst, wenn zwei aufeinanderfolgende Lesungen
   * übereinstimmen. Ohne diese Regel schleichen sich Zifferndreher ein —
   * und ein falsch gelesenes Etikett bucht still das falsche Gerät.
   */
  let vorletzte: string | null = null;

  async function nativVerfuegbar(): Promise<boolean> {
    const D = (window as unknown as { BarcodeDetector?: BarcodeDetectorKonstruktor })
      .BarcodeDetector;
    if (!D) return false;
    try {
      const formate = await D.getSupportedFormats();
      return formate.includes("code_128");
    } catch {
      return false;
    }
  }

  async function starte(el: HTMLVideoElement): Promise<void> {
    if (zustand.value === "laeuft" || zustand.value === "startet") return;
    video.value = el;
    zustand.value = "startet";
    fehlertext.value = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      zustand.value = "nicht_unterstuetzt";
      fehlertext.value =
        location.protocol === "https:" || location.hostname === "localhost"
          ? "Dieser Browser kann nicht auf die Kamera zugreifen."
          : "Die Kamera funktioniert nur über eine gesicherte Verbindung (https).";
      return;
    }

    try {
      strom = await navigator.mediaDevices.getUserMedia({
        // Hohe Auflösung: ein Strichcode braucht Detail über die volle Breite.
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    } catch (fehler) {
      const name = (fehler as DOMException)?.name ?? "";
      if (name === "NotAllowedError") {
        zustand.value = "kein_zugriff";
        fehlertext.value =
          "Der Zugriff auf die Kamera wurde abgelehnt. In den Browsereinstellungen erlauben — oder die Nummer eintippen.";
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        zustand.value = "kein_geraet";
        fehlertext.value = "Keine Kamera gefunden. Bitte die Nummer eintippen.";
      } else {
        zustand.value = "nicht_unterstuetzt";
        fehlertext.value = "Die Kamera lässt sich nicht öffnen. Bitte die Nummer eintippen.";
      }
      return;
    }

    el.srcObject = strom;
    el.setAttribute("playsinline", "true");
    await el.play().catch(() => {});

    const spur = strom.getVideoTracks()[0];
    const koennen = spur?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    lichtMoeglich.value = Boolean(koennen && "torch" in koennen);

    if (await nativVerfuegbar()) {
      const D = (window as unknown as { BarcodeDetector: BarcodeDetectorKonstruktor })
        .BarcodeDetector;
      nativerLeser = new D({ formats: ["code_128"] });
    } else {
      // Dynamisch: Das WebAssembly wird nur geladen, wo es gebraucht wird.
      zxing = await import("zxing-wasm/reader");
      const wasm = (await import("zxing-wasm/reader/zxing_reader.wasm?url")).default;
      zxing.prepareZXingModule({ overrides: { locateFile: () => wasm } });
    }

    zustand.value = "laeuft";
    angehalten = false;
    vorletzte = null;
    start = performance.now();
    schleife = requestAnimationFrame(takt);
  }

  let letzterVersuch = 0;

  async function takt(jetzt: number): Promise<void> {
    if (zustand.value !== "laeuft") return;
    laeuftSeitMs.value = jetzt - start;

    if (!angehalten && jetzt - letzterVersuch >= TAKT_MS) {
      letzterVersuch = jetzt;
      const treffer = await leseEinmal();
      if (treffer) {
        if (vorletzte === treffer.code) {
          melde(treffer);
        } else {
          vorletzte = treffer.code;
        }
      }
    }
    schleife = requestAnimationFrame(takt);
  }

  async function leseEinmal(): Promise<ScanTreffer | null> {
    const el = video.value;
    if (!el || !stift || !el.videoWidth) return null;

    leinwand.width = el.videoWidth;
    leinwand.height = el.videoHeight;
    stift.drawImage(el, 0, 0, leinwand.width, leinwand.height);

    try {
      if (nativerLeser) {
        const gefunden = await nativerLeser.detect(leinwand);
        const erster = gefunden[0];
        if (erster?.rawValue) {
          return { code: erster.rawValue, quelle: "kamera", format: erster.format };
        }
        return null;
      }

      if (zxing) {
        const bild = stift.getImageData(0, 0, leinwand.width, leinwand.height);
        const gefunden = await zxing.readBarcodes(bild, {
          formats: ["Code128"],
          tryHarder: true,
          // Etiketten kleben auch hochkant auf den Maschinen.
          tryRotate: true,
          tryInvert: true,
          tryDownscale: true,
          maxNumberOfSymbols: 1,
        });
        const erster = gefunden[0];
        if (erster?.text) return { code: erster.text, quelle: "kamera", format: erster.format };
      }
    } catch {
      // Ein einzelnes unlesbares Bild ist der Normalfall, kein Fehler.
    }
    return null;
  }

  function melde(treffer: ScanTreffer): void {
    // Nach einem Treffer anhalten, sonst wird im Hintergrund weitergescannt
    // und die nächste Buchung fängt von selbst an.
    angehalten = true;
    if (navigator.vibrate) navigator.vibrate(60);
    piep();
    for (const fn of zuhoerer) fn(treffer);
  }

  /** Weitersuchen, nachdem der Benutzer den Treffer abgearbeitet hat. */
  function weiter(): void {
    vorletzte = null;
    angehalten = false;
    start = performance.now();
    laeuftSeitMs.value = 0;
  }

  /**
   * Alles abräumen. Wird das vergessen, bleibt die Kameraleuchte an, der
   * Akku leert sich, und iOS verweigert beim nächsten Mal den Zugriff.
   */
  function stoppe(): void {
    if (schleife !== null) cancelAnimationFrame(schleife);
    schleife = null;
    strom?.getTracks().forEach((spur) => spur.stop());
    strom = null;
    if (video.value) video.value.srcObject = null;
    nativerLeser = null;
    lichtAn.value = false;
    lichtMoeglich.value = false;
    zustand.value = "aus";
  }

  async function lichtSchalten(): Promise<void> {
    const spur = strom?.getVideoTracks()[0];
    if (!spur) return;
    lichtAn.value = !lichtAn.value;
    try {
      await spur.applyConstraints({
        advanced: [{ torch: lichtAn.value } as MediaTrackConstraintSet],
      });
    } catch {
      lichtAn.value = false;
      lichtMoeglich.value = false;
    }
  }

  function piep(): void {
    // Bei Sonne aufs Display sieht man die Rückmeldung nicht — hören schon.
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new AC();
      const ton = ac.createOscillator();
      const laut = ac.createGain();
      ton.frequency.value = 880;
      laut.gain.value = 0.12;
      ton.connect(laut);
      laut.connect(ac.destination);
      ton.start();
      setTimeout(() => {
        ton.stop();
        void ac.close();
      }, 110);
    } catch {
      /* Ton ist Beiwerk */
    }
  }

  onScopeDispose(stoppe);

  return {
    zustand: readonly(zustand),
    fehlertext: readonly(fehlertext),
    lichtMoeglich: readonly(lichtMoeglich),
    lichtAn: readonly(lichtAn),
    laeuftSeitMs: readonly(laeuftSeitMs),
    starte,
    stoppe,
    weiter,
    lichtSchalten,
    beiTreffer,
  };
}

interface BarcodeDetectorKonstruktor {
  new (optionen?: { formats?: string[] }): {
    detect(quelle: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
  };
  getSupportedFormats(): Promise<string[]>;
}
