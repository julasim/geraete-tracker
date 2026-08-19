// Scanner-Machbarkeitstest (AP1) — Wegwerf-Code, dient nur der Messung.
// Beantwortet drei Fragen: Welches Barcode-Format tragen die Etiketten?
// Wie hoch ist die Trefferquote mit der Handykamera? Wie lange dauert ein Scan?

import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

// WASM lokal laden statt vom CDN — beweist gleich, dass die spätere App ohne
// Außenkontakt auskommt (siehe Google-Fonts-Befund in rag-os-app-lokal).
prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });

const el = (id) => document.getElementById(id);
const video = el("video");
const status = el("status");

const VERSUCH_MS = 15_000;
const BILDER_PRO_SEK = 10;

let stream = null;
let track = null;
let laeuft = false;          // Versuch aktiv?
let abbrechen = null;
const protokoll = [];

// ── Umgebung ────────────────────────────────────────────────────────────────
const nativVerfuegbar = "BarcodeDetector" in window;
(async () => {
  let formate = [];
  if (nativVerfuegbar) {
    try { formate = await window.BarcodeDetector.getSupportedFormats(); } catch { /* egal */ }
  }
  el("umgebung").textContent =
    `BarcodeDetector: ${nativVerfuegbar ? "vorhanden (" + formate.join(", ") + ")" : "nicht vorhanden"} · ` +
    `zxing-wasm: geladen · ${navigator.userAgent.slice(0, 60)}…`;
})();

// ── Kamera ──────────────────────────────────────────────────────────────────
el("btnKamera").addEventListener("click", async () => {
  if (stream) { stoppeKamera(); return; }
  status.textContent = "Kamera wird geöffnet …";
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    status.textContent = "Kein Kamerazugriff: " + e.name +
      (location.protocol !== "https:" && location.hostname !== "localhost"
        ? " — die Seite muss über HTTPS laufen!" : "");
    return;
  }
  video.srcObject = stream;
  await video.play();
  track = stream.getVideoTracks()[0];
  const s = track.getSettings();
  status.textContent = `Bereit — ${s.width}×${s.height}`;
  el("btnKamera").textContent = "Kamera stoppen";
  el("btnVersuch").disabled = false;
  const faehig = track.getCapabilities?.() ?? {};
  el("btnLampe").disabled = !("torch" in faehig);
});

function stoppeKamera() {
  laeuft = false;
  abbrechen?.();
  stream?.getTracks().forEach((t) => t.stop());   // JEDEN Track stoppen, sonst bleibt die Leuchte an
  stream = null; track = null; video.srcObject = null;
  el("btnKamera").textContent = "Kamera starten";
  el("btnVersuch").disabled = true;
  el("btnLampe").disabled = true;
  status.textContent = "Kamera aus";
}

let lampeAn = false;
el("btnLampe").addEventListener("click", async () => {
  if (!track) return;
  lampeAn = !lampeAn;
  try { await track.applyConstraints({ advanced: [{ torch: lampeAn }] }); }
  catch { status.textContent = "Licht lässt sich hier nicht schalten"; }
});

el("btnDrehen").addEventListener("click", () => {
  const r = el("rahmen");
  r.classList.toggle("hoch");
  el("btnDrehen").textContent = r.classList.contains("hoch") ? "Rahmen quer" : "Rahmen hochkant";
});

// ── Lesen ───────────────────────────────────────────────────────────────────
const leinwand = document.createElement("canvas");
const stift = leinwand.getContext("2d", { willReadFrequently: true });

function bildHolen() {
  const b = video.videoWidth, h = video.videoHeight;
  if (!b || !h) return null;
  leinwand.width = b; leinwand.height = h;
  stift.drawImage(video, 0, 0, b, h);
  return stift.getImageData(0, 0, b, h);
}

let nativLeser = null;
async function leseNativ(bild) {
  if (!nativLeser) nativLeser = new window.BarcodeDetector();
  const treffer = await nativLeser.detect(leinwand);
  if (!treffer.length) return null;
  return { wert: treffer[0].rawValue, format: treffer[0].format, weg: "nativ" };
}

async function leseZxing(bild) {
  const formate = el("formate").value;
  const treffer = await readBarcodes(bild, {
    formats: [formate],
    tryHarder: true,
    tryRotate: true,      // hochkant geklebte Etiketten (wie 10013)
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 1,
  });
  const t = treffer.find((x) => x.isValid !== false && x.text);
  return t ? { wert: t.text, format: t.format, weg: "zxing" } : null;
}

async function leseEinmal() {
  const bild = bildHolen();
  if (!bild) return null;
  const modus = el("modus").value;
  const nativMoeglich = nativVerfuegbar && (modus === "nativ" || modus === "auto");
  if (nativMoeglich) {
    try { const r = await leseNativ(bild); if (r) return r; } catch { /* auf zxing zurückfallen */ }
  }
  if (modus === "nativ") return null;
  return leseZxing(bild);
}

// ── Versuch ─────────────────────────────────────────────────────────────────
el("btnVersuch").addEventListener("click", async () => {
  if (laeuft) return;
  laeuft = true;
  el("btnVersuch").disabled = true;
  const start = performance.now();
  let gestoppt = false;
  abbrechen = () => { gestoppt = true; };

  // Zwei übereinstimmende Lesungen, bevor ein Code gilt — sonst schleichen sich
  // Zifferndreher ein, die still das falsche Gerät buchen würden.
  let vorletzte = null;
  let ergebnis = null;

  while (!gestoppt && performance.now() - start < VERSUCH_MS) {
    const rest = ((VERSUCH_MS - (performance.now() - start)) / 1000).toFixed(0);
    status.textContent = `Suche … ${rest} s`;
    let r = null;
    try { r = await leseEinmal(); } catch (e) { status.textContent = "Lesefehler: " + e.message; }
    if (r) {
      if (vorletzte && vorletzte.wert === r.wert) { ergebnis = r; break; }
      vorletzte = r;
    }
    await new Promise((f) => setTimeout(f, 1000 / BILDER_PRO_SEK));
  }

  const dauer = Math.round(performance.now() - start);
  if (ergebnis) {
    navigator.vibrate?.(60);
    piep();
    status.textContent = `✓ ${ergebnis.wert}  (${ergebnis.format})`;
    eintragen({ ...ergebnis, dauer, ok: true });
  } else {
    status.textContent = "✗ nicht gelesen";
    eintragen({ wert: "—", format: "—", weg: "—", dauer, ok: false });
  }
  laeuft = false;
  el("btnVersuch").disabled = !stream;
});

function piep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(ac.destination); o.start();
    setTimeout(() => { o.stop(); ac.close(); }, 120);
  } catch { /* Ton ist Beiwerk */ }
}

// ── Protokoll und Statistik ─────────────────────────────────────────────────
function eintragen(e) {
  protokoll.push(e);
  const koerper = el("protokoll");
  if (protokoll.length === 1) koerper.innerHTML = "";
  const tr = document.createElement("tr");
  tr.innerHTML =
    `<td>${protokoll.length}</td>` +
    `<td class="${e.ok ? "ok" : "nok"}">${e.wert}</td>` +
    `<td>${e.format}</td><td>${(e.dauer / 1000).toFixed(1)} s</td><td>${e.weg}</td>`;
  koerper.prepend(tr);
  rechne();
}

function rechne() {
  const n = protokoll.length;
  const treffer = protokoll.filter((e) => e.ok);
  el("zVersuche").textContent = n;
  el("zTreffer").textContent = treffer.length;
  const quote = n ? Math.round((treffer.length / n) * 100) : null;
  el("zQuote").textContent = quote === null ? "–" : quote + " %";
  const zeiten = treffer.map((e) => e.dauer).sort((a, b) => a - b);
  el("zZeit").textContent = zeiten.length ? (zeiten[Math.floor(zeiten.length / 2)] / 1000).toFixed(1) + " s" : "–";

  const b = el("bewertung");
  if (n < 10) { b.textContent = `Aussagekräftig ab etwa 15 Versuchen — noch ${Math.max(0, 15 - n)} zu gehen.`; b.className = "hinweis"; }
  else if (quote >= 70) { b.textContent = `Trefferquote ${quote} % — Kamera-Scan ist alltagstauglich, wir bauen wie geplant.`; b.className = "hinweis ok"; }
  else { b.textContent = `Trefferquote ${quote} % — zu niedrig. Ein Bluetooth-Handscanner wird der Hauptweg.`; b.className = "hinweis nok"; }

  const formate = [...new Set(treffer.map((e) => e.format))];
  if (formate.length) b.textContent += `  Erkanntes Format: ${formate.join(", ")}.`;
}

el("btnLeeren").addEventListener("click", () => {
  protokoll.length = 0;
  el("protokoll").innerHTML = `<tr><td colspan="5" class="hinweis">noch keine Versuche</td></tr>`;
  rechne();
});

el("btnKopieren").addEventListener("click", async () => {
  const treffer = protokoll.filter((e) => e.ok);
  const zeiten = treffer.map((e) => e.dauer).sort((a, b) => a - b);
  const text = [
    `# Scanner-Abnahme AP1`,
    ``,
    `Gerät: ${navigator.userAgent}`,
    `Versuche: ${protokoll.length} · Treffer: ${treffer.length} · ` +
      `Quote: ${protokoll.length ? Math.round(treffer.length / protokoll.length * 100) : 0} % · ` +
      `Median: ${zeiten.length ? (zeiten[Math.floor(zeiten.length / 2)] / 1000).toFixed(1) : "–"} s`,
    `Formate: ${[...new Set(treffer.map((e) => e.format))].join(", ") || "–"}`,
    ``,
    `| # | Wert | Format | Dauer | Weg |`,
    `|---|------|--------|-------|-----|`,
    ...protokoll.map((e, i) => `| ${i + 1} | ${e.wert} | ${e.format} | ${(e.dauer / 1000).toFixed(1)} s | ${e.weg} |`),
  ].join("\n");
  try { await navigator.clipboard.writeText(text); el("btnKopieren").textContent = "kopiert ✓"; }
  catch { prompt("Text kopieren:", text); }
  setTimeout(() => (el("btnKopieren").textContent = "Protokoll kopieren"), 2000);
});

// ── Foto prüfen ─────────────────────────────────────────────────────────────
el("datei").addEventListener("change", async (ev) => {
  const f = ev.target.files?.[0];
  if (!f) return;
  const ziel = el("dateiErgebnis");
  ziel.textContent = "wird gelesen …";
  const start = performance.now();
  try {
    const treffer = await readBarcodes(f, {
      formats: ["AllLinear"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true,
    });
    const dauer = ((performance.now() - start) / 1000).toFixed(1);
    ziel.innerHTML = treffer.length
      ? treffer.map((t) => `<span class="ok">✓ ${t.text}</span> — Format <code>${t.format}</code> (${dauer} s)`).join("<br>")
      : `<span class="nok">✗ kein Code gefunden</span> (${dauer} s)`;
  } catch (e) {
    ziel.innerHTML = `<span class="nok">Fehler: ${e.message}</span>`;
  }
});

window.addEventListener("pagehide", stoppeKamera);
