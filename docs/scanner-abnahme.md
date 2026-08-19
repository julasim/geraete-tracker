# AP1 — Scanner-Abnahme

Beantwortet drei Fragen, bevor irgendetwas gebaut wird:
**Welches Format tragen die Etiketten? Liest die Handykamera sie zuverlässig? Wie lange dauert ein Scan?**

Testwerkzeug: `../scanner-test/` (Wegwerf-Code, wird nach der Abnahme gelöscht).

---

## Stand 2026-08-16

### Was über die Etiketten bekannt ist

Aus zwei Fotos von Julius:

| | Etikett 1 | Etikett 2 |
|---|---|---|
| Nummer | `10001` | `10013` |
| Anbringung | eben, sauber, quer | **hochkant**, auf Metall, Ölspuren am oberen Rand |

**Fünfstellig und fortlaufend.** Die Barcode-Nummer *ist* damit die Inventarnummer — kein
zweites Nummernfeld nötig.

**Format geklärt: Code 128.** Am 16.08.2026 über die Foto-Prüfung der Testseite bestimmt —
Etikett 10013 wurde als `Code128` gelesen. *(Meine Vermutung aus dem Foto ging Richtung
Code 39/ITF und war falsch — die Breite kommt daher, dass Code 128 hier offenbar jede Ziffer
einzeln codiert statt paarweise.)*

**Das ist der günstigste Fall:**
- Code 128 trägt eine **Prüfsumme im Symbol**. Halb gelesene Codes werden verworfen statt
  falsch interpretiert — bei einem Buchungssystem der entscheidende Unterschied.
- **Keine Stellenzahl-Falle** wie bei ITF: was auf dem Etikett steht, kommt auch aus dem Scanner.
- `BarcodeDetector` unterstützt `code_128` — auf Android ist der schnelle native Weg nutzbar.
- Neue Etiketten mit `bwip-js` unmittelbar erzeugbar, Nummernreihe läuft ab 10001 weiter.

**Folge für den Bau:** Der Leser wird auf `formats: ["Code128"]` festgelegt — schneller als
`AllLinear` und verhindert, dass ein anderes Format fälschlich anspringt.

**Zwei Praxisbefunde, die den Entwurf betreffen:**
1. **Hochkant geklebte Etiketten sind normal.** Der Sucher braucht einen umschaltbaren Rahmen,
   und der Leser muss `tryRotate` aktiviert haben. Beides ist in der Testseite umgesetzt.
2. **Verschmutzung tritt real auf** (Öl am Rand von 10013). Bestätigt die Sorge aus dem Plan.

### Bereits geprüft (ohne Kamera)

**Lesekette funktioniert.** `node selbsttest.mjs` erzeugt Barcodes mit genau diesen Nummern
und liest sie wieder ein:

```
OK   Code39   "10001" → "10001"  (4 ms)
OK   Code128  "10001" → "10001"  (3 ms)
OK   Code93   "10001" → "10001"  (2 ms)
NULL ITF      "10001" → "010001"     ← führende Null
```

**Befund zu ITF: verlangt eine gerade Stellenzahl** und ergänzt bei fünf Ziffern eine führende
Null (`10001` → `010001`). **Für dieses Projekt entwarnt**, da die Etiketten Code 128 sind.
Die Normalisierung in `src/domain/barcode.ts` bleibt trotzdem im Plan, aber aus einem anderen
Grund: Leerzeichen und Groß-/Kleinschreibung bei der **Handeingabe** und bei
Hardware-Scannern, die Suffixe anhängen.

*(Codabar lässt sich mit reinen Ziffern nicht erzeugen — braucht Start-/Stoppbuchstaben.
Als Etikettenformat hier praktisch ausgeschlossen.)*

**Browser-Pfad funktioniert.** Testseite geladen, Foto eingelesen, Ergebnis
`✓ 10001 — Format Code39`. Das WASM wurde nachweislich von `localhost` geladen
(Netzwerkprotokoll geprüft), **nicht von einem CDN** — die spätere App kommt ohne
Außenkontakt aus.

### Offen: der Test am echten Etikett

Fehlt noch, und nur der zählt: **Kamera-Scan auf iPad und Android an echten Etiketten.**
Dafür braucht die Seite eine HTTPS-Adresse (siehe unten).

---

## Durchführung

### 1. Seite erreichbar machen

Die Kamera gibt der Browser nur im *secure context* frei. `http://` im WLAN reicht **nicht** —
Safari verweigert dann den Zugriff, auch nach Zustimmung. Nötig ist eine echte HTTPS-Adresse,
z. B. über einen temporären Tunnel.

```bash
cd apps/geraete-tracker/scanner-test && npm run dev
```

### 2. Messen

Je Versuch: Etikett anvisieren → **„Versuch starten"** → die Seite sucht 15 Sekunden lang und
protokolliert Treffer, Format und Dauer. Ein Code gilt erst nach **zwei übereinstimmenden
Lesungen** — das verhindert Zifferndreher, die sonst still das falsche Gerät buchen würden.

**Mindestens 15 Versuche**, und bewusst die schwierigen Fälle:

- [ ] sauberes Etikett, eben, gute Beleuchtung (Referenz)
- [ ] **hochkant geklebtes** Etikett wie 10013
- [ ] verschmutztes / öliges Etikett
- [ ] auf gewölbter Fläche (Rohr, Griff)
- [ ] Gegenlicht und pralle Sonne
- [ ] Halbdunkel, mit und ohne Licht-Knopf
- [ ] aus ~30 cm Abstand
- [ ] schräg von der Seite (~30°)
- [ ] mit Arbeitshandschuhen bedient
- [ ] iPad **und** Android-Handy

Dann **„Protokoll kopieren"** und das Ergebnis unten einfügen.

### 3. Entscheidung

| Trefferquote | Folge |
|---|---|
| **≥ 70 %** | Kamera-Scan wird der Hauptweg. Weiter mit AP2 wie geplant. |
| **< 70 %** | **Bluetooth-Handscanner wird der Hauptweg** (40–120 €, meldet sich als Tastatur). Die Kamera bleibt als Zusatz. Aufwand in der App: nahezu null — das Handeingabefeld nimmt die Scanner-Eingabe bereits entgegen. |

---

## Ergebnis

_(nach dem Test hier einfügen)_

**Erkanntes Format:** Code 128 ✓ (16.08.2026, über Foto-Prüfung)
**Stellenzahl:** 5, numerisch, fortlaufend ab 10001 ✓
**Trefferquote:** _offen — Kamera-Test am iPad steht aus_
**Mediandauer:** _offen_
**Entscheidung:** _offen_
