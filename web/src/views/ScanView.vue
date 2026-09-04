<script setup lang="ts">
/**
 * Scannen. Der Bildschirm, den die Mitarbeiter am häufigsten sehen.
 *
 * Zwei Wege stehen gleichrangig nebeneinander: Kamera und Handeingabe.
 * Das ist kein Zugeständnis, sondern Notwendigkeit — Strichcodes sind mit
 * der Handykamera deutlich fehleranfälliger als QR-Codes, und ein
 * verschmutztes Etikett auf einer gewölbten Fläche im Gegenlicht liest
 * keine Kamera zuverlässig.
 *
 * **Diese Ansicht ist die Landeseite für jeden Benutzer**, auch am
 * Schreibtisch (`/` leitet hierher, und der Wächter schickt Unbekanntes
 * ebenfalls hierher). Was hier steht, sieht also wirklich jeder — deshalb
 * hängen Buchungs- und Sammelknöpfe an `buchungen.erfassen`.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { darfNach } from "@/rechte-pfade";
import { useBestand } from "@/stores/bestand";
import { useScanner } from "@/composables/useScanner";
import type { Geraet, ScanErgebnis } from "@/typen";
import Symbol from "@/components/Symbol.vue";
import StatusChip from "@/components/StatusChip.vue";

const router = useRouter();
const bestand = useBestand();
const scanner = useScanner();

/**
 * Darf dieser Benutzer überhaupt buchen?
 *
 * Beide Ziele — `/buchen/:id/:art` und `/sammeln/:art` — verlangen
 * `buchungen.erfassen`. Gefragt wird über den Zielpfad statt über das Recht,
 * damit Knopf und Route nicht getrennt gepflegt werden müssen.
 */
const darfBuchen = computed(() => darfNach("/sammeln/ausgabe"));

const videoEl = ref<HTMLVideoElement | null>(null);
const eingabe = ref("");
const eingabeEl = ref<HTMLInputElement | null>(null);
const handEingabeOffen = ref(false);
const laeuft = ref(false);
const fehler = ref<string | null>(null);
const ergebnis = ref<ScanErgebnis | null>(null);

onMounted(async () => {
  await bestand.laden();
  if (videoEl.value) await scanner.starte(videoEl.value);
});

// Wenn die Kamera nicht will, ist die Handeingabe der einzige Weg —
// dann gleich aufmachen statt den Nutzer suchen zu lassen.
watch(
  () => scanner.zustand.value,
  (z) => {
    if (z === "kein_zugriff" || z === "nicht_unterstuetzt" || z === "kein_geraet") {
      handEingabeOffen.value = true;
    }
  },
);

// Nach zehn Sekunden ohne Treffer die Handeingabe von selbst anbieten.
watch(
  () => scanner.laeuftSeitMs.value,
  (ms) => {
    if (ms > 10_000 && !handEingabeOffen.value && !ergebnis.value) handEingabeOffen.value = true;
  },
);

scanner.beiTreffer((treffer) => void nachschlagen(treffer.code));

async function nachschlagen(code: string): Promise<void> {
  if (!code.trim() || laeuft.value) return;
  laeuft.value = true;
  fehler.value = null;
  try {
    ergebnis.value = await api.get<ScanErgebnis>(`/scan/${encodeURIComponent(code.trim())}`);
    // Im Sammelmodus nur einsammeln — die Gerätekarte erscheint nicht.
    // Ein Regalplatz-Treffer bleibt außen vor: Man sammelt Geräte, keine Orte.
    if (ergebnis.value?.typ === "geraet") trefferAufnehmen(ergebnis.value.geraet);
  } catch (f) {
    if (f instanceof ApiError && (f.status === 404 || f.status === 409)) {
      // 404 und 409 sind hier keine Fehler, sondern Antworten: unbekannter
      // Code bzw. mehrere passende Geräte.
      ergebnis.value = f.body as unknown as ScanErgebnis;
    } else {
      fehler.value = f instanceof Error ? f.message : "Unbekannter Fehler";
    }
  } finally {
    laeuft.value = false;
  }
}

function handEingabeAbschicken(): void {
  const wert = eingabe.value;
  eingabe.value = "";
  void nachschlagen(wert);
}

function weiterScannen(): void {
  ergebnis.value = null;
  fehler.value = null;
  eingabe.value = "";
  scanner.weiter();
}

function oeffneGeraet(g: Geraet | { id: string }): void {
  void router.push(`/geraete/${g.id}`);
}

/**
 * Ist die Kamera dauerhaft nicht zu haben?
 *
 * Dann schrumpft der schwarze Sucher auf die Meldung zusammen und gibt den
 * Platz an die Handeingabe ab. Ausdrücklich NICHT bei "startet" oder "aus":
 * Dort kommt die Kamera gleich, und ein springendes Layout unter dem Daumen
 * ist schlimmer als ein Moment ungenutzter Fläche.
 *
 * Vorher belegte der leere Sucher auch ohne Kamera die halbe Höhe — gerade
 * im Handeingabe-Fall, wo die Trefferliste den Platz braucht.
 */
const ohneKamera = computed(() =>
  ["kein_zugriff", "kein_geraet", "nicht_unterstuetzt"].includes(scanner.zustand.value),
);

/**
 * Die Buchungsknöpfe auf der Trefferkarte.
 *
 * Welche Buchung fachlich möglich ist, sagt der Server; ob dieser Benutzer
 * sie anstoßen darf, sagt das Recht. Vorher stand hier die rohe Serverliste:
 * Ein Mitarbeiter ohne `buchungen.erfassen` scannte, drückte „Ausgeben" und
 * wurde vom Wächter wortlos in die Geräteliste zurückgeworfen.
 */
const erlaubteAktionen = computed(() =>
  ergebnis.value?.typ === "geraet" && darfBuchen.value ? ergebnis.value.aktionen : [],
);

/**
 * Sammelmodus — mehrere Geräte für EINE Buchung zusammentragen.
 *
 * Der Fall aus dem Bauhof: Zehn Geräte gehen auf dieselbe Baustelle. Einzeln
 * gebucht sind das dreißig Handgriffe; gesammelt sind es zwölf.
 *
 * Bewusst ein **Schalter** und kein neuer Standard: Ein einzelnes Gerät zu
 * buchen bleibt der häufigste Fall und darf dadurch nicht länger werden.
 */
const sammelmodus = ref(false);

/** Im Sammelmodus wandert ein Treffer in die Liste, statt die Karte zu zeigen. */
function trefferAufnehmen(g: { id: string }): boolean {
  if (!sammelmodus.value) return false;
  bestand.sammle(g.id);
  // Sofort weiterscannen: Die Karte würde nur im Weg stehen.
  ergebnis.value = null;
  eingabe.value = "";
  return true;
}

const gesammelt = computed(() => bestand.gesammelteGeraete);

function sammelBuchen(art: "ausgabe" | "ruecknahme" | "umbuchung"): void {
  void router.push(`/sammeln/${art}`);
}

/** Vorschläge aus dem bereits geladenen Bestand — ohne Serveraufruf. */
const vorschlaege = ref<Geraet[]>([]);
watch(eingabe, (wert) => {
  vorschlaege.value = wert.trim().length >= 2 ? bestand.suche(wert).slice(0, 6) : [];
});
</script>

<template>
  <div class="scan">
    <!-- ── Sammelmodus ──────────────────────────────────────
         Ohne `buchungen.erfassen` gar nicht erst anbieten: Sammeln ist der
         Anlauf zu `/sammeln/:art`, und dort endet der Weg im stummen
         Rückwurf — nach zehn gescannten Geräten. -->
    <div v-if="darfBuchen" class="sammelleiste">
      <label class="sammelschalter">
        <input v-model="sammelmodus" type="checkbox" class="sammelschalter__feld" />
        <span class="sammelschalter__text">Mehrere sammeln</span>
      </label>
      <button
        v-if="gesammelt.length"
        class="pt-btn pt-btn--still kleinknopf"
        @click="bestand.sammlungLeeren()"
      >
        Liste leeren
      </button>
    </div>

    <!-- ── Sucher ─────────────────────────────────────────── -->
    <div class="sucher" :class="{ 'sucher--ohne-kamera': ohneKamera }">
      <video ref="videoEl" class="sucher__bild" playsinline muted autoplay></video>

      <!-- Der Rahmen liegt quer wie ein Strichcode: das führt von selbst
           zur richtigen Haltung des Geräts. -->
      <div v-if="!ergebnis" class="sucher__rahmen" aria-hidden="true">
        <div class="sucher__fenster"></div>
      </div>

      <div v-if="scanner.zustand.value !== 'laeuft' && !ergebnis" class="sucher__meldung">
        <template v-if="scanner.zustand.value === 'startet'">Kamera wird geöffnet …</template>
        <template v-else-if="scanner.fehlertext.value">{{ scanner.fehlertext.value }}</template>
        <template v-else>Kamera aus</template>
      </div>

      <!--
        Ohne Kamera sind beide Knöpfe gegenstandslos: Licht schaltet nichts,
        und die Handeingabe steht bereits offen. Sie blieben sonst über der
        Meldung liegen, seit der Sucher auf sie zusammenschrumpft.
      -->
      <div v-if="!ohneKamera" class="sucher__knoepfe">
        <button
          v-if="scanner.lichtMoeglich.value"
          class="rundknopf"
          :class="{ 'rundknopf--an': scanner.lichtAn.value }"
          :aria-pressed="scanner.lichtAn.value"
          aria-label="Licht"
          @click="scanner.lichtSchalten()"
        >
          <Symbol name="licht" :groesse="20" />
        </button>
        <button
          class="rundknopf"
          aria-label="Nummer eintippen"
          @click="
            handEingabeOffen = !handEingabeOffen;
            handEingabeOffen && eingabeEl?.focus();
          "
        >
          <Symbol name="tastatur" :groesse="20" />
        </button>
      </div>
    </div>

    <!-- ── Handeingabe ────────────────────────────────────── -->
    <div v-if="handEingabeOffen && !ergebnis" class="hand">
      <label class="pt-label" for="nummer">Nummer vom Etikett</label>
      <div class="hand__zeile">
        <input
          id="nummer"
          ref="eingabeEl"
          v-model="eingabe"
          class="pt-feld pt-mono hand__feld"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="z. B. 10013"
          @keyup.enter="handEingabeAbschicken"
        />
        <button class="pt-btn pt-btn--primaer" :disabled="!eingabe.trim()" @click="handEingabeAbschicken">
          Suchen
        </button>
      </div>

      <ul v-if="vorschlaege.length" class="pt-karte pt-liste hand__vorschlaege">
        <li v-for="g in vorschlaege" :key="g.id">
          <button class="pt-zeile" @click="oeffneGeraet(g)">
            <div class="pt-zeile__haupt">
              <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
              <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
            </div>
            <StatusChip :status="g.status" />
          </button>
        </li>
      </ul>
    </div>

    <p v-if="fehler" class="pt-meldung pt-meldung--fehler scan__meldung">{{ fehler }}</p>

    <!-- ── Ergebnis ───────────────────────────────────────── -->
    <div v-if="ergebnis" class="ergebnis">
      <!-- Gerät -->
      <template v-if="ergebnis.typ === 'geraet'">
        <div v-if="ergebnis.warnungen.length" class="warnungen">
          <p v-for="(w, i) in ergebnis.warnungen" :key="i" class="pt-meldung pt-meldung--warnung warn">
            <Symbol name="warnung" :groesse="18" />
            <span>{{ w.text }}</span>
          </p>
        </div>

        <div class="pt-karte karte">
          <div class="karte__kopf">
            <div>
              <p class="pt-mikro">{{ ergebnis.geraet.inventarnummer }}</p>
              <h2 class="karte__titel">{{ ergebnis.geraet.bezeichnung }}</h2>
            </div>
            <StatusChip :status="ergebnis.geraet.status" gross />
          </div>

          <!-- Ein Satz in Klartext statt einer Feldtabelle: das ist die
               Information, die auf der Baustelle zählt. -->
          <p class="karte__satz">
            <template v-if="ergebnis.geraet.status === 'ausgegeben'">
              Steht auf <strong>{{ ergebnis.geraet.standort ?? "unbekannt" }}</strong
              ><template v-if="ergebnis.geraet.nutzer"
                >, übernommen von <strong>{{ ergebnis.geraet.nutzer }}</strong></template
              >.
            </template>
            <template v-else-if="ergebnis.geraet.lagerplatz">
              Liegt in <strong>{{ ergebnis.geraet.lagerplatz }}</strong>
              ({{ ergebnis.geraet.standort }}).
            </template>
            <template v-else-if="ergebnis.geraet.standort">
              Steht im <strong>{{ ergebnis.geraet.standort }}</strong
              >.
            </template>
            <template v-else>Kein Standort hinterlegt.</template>
          </p>

          <p v-if="ergebnis.hinweis" class="pt-meldung pt-meldung--hinweis karte__hinweis">
            {{ ergebnis.hinweis }}
          </p>

          <div class="karte__aktionen">
            <button
              v-for="a in erlaubteAktionen"
              :key="a.art"
              class="pt-btn pt-btn--breit"
              :class="a.hauptaktion ? 'pt-btn--primaer pt-btn--gross' : ''"
              @click="router.push(`/buchen/${ergebnis.geraet.id}/${a.art}`)"
            >
              {{ a.text }}
            </button>
            <button class="pt-btn pt-btn--breit" @click="oeffneGeraet(ergebnis.geraet)">
              Details ansehen
            </button>
          </div>
        </div>
      </template>

      <!-- Lagerplatz -->
      <template v-else-if="ergebnis.typ === 'lagerplatz'">
        <div class="pt-karte karte">
          <div class="karte__kopf">
            <div>
              <p class="pt-mikro">Lagerplatz {{ ergebnis.lagerplatz.barcode }}</p>
              <h2 class="karte__titel">{{ ergebnis.lagerplatz.bezeichnung }}</h2>
            </div>
          </div>
          <p class="karte__satz">
            {{
              ergebnis.geraete.length === 0
                ? "Hier liegt derzeit nichts."
                : ergebnis.geraete.length === 1
                  ? "Hier liegt ein Gerät."
                  : `Hier liegen ${ergebnis.geraete.length} Geräte.`
            }}
          </p>
          <ul class="pt-liste">
            <li v-for="g in ergebnis.geraete" :key="g.id">
              <button class="pt-zeile" @click="oeffneGeraet(g)">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
                </div>
              </button>
            </li>
          </ul>
        </div>
      </template>

      <!-- Mehrere passende Geräte -->
      <template v-else-if="ergebnis.typ === 'mehrdeutig'">
        <div class="pt-karte karte">
          <p class="pt-meldung pt-meldung--warnung">{{ ergebnis.hinweis }}</p>
          <ul class="pt-liste">
            <li v-for="g in ergebnis.geraete" :key="g.id">
              <button class="pt-zeile" @click="oeffneGeraet(g)">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
                </div>
                <StatusChip :status="g.status" />
              </button>
            </li>
          </ul>
        </div>
      </template>

      <!-- Unbekannt -->
      <template v-else>
        <div class="pt-karte karte">
          <p class="pt-mikro">Gescannt</p>
          <h2 class="karte__titel pt-mono">{{ ergebnis.code }}</h2>
          <p class="karte__satz">{{ ergebnis.hinweis }}</p>
          <div class="karte__aktionen">
            <button
              v-if="
                ergebnis.anlegbar &&
                ergebnis.grund === 'geraet_nicht_erfasst' &&
                darfNach('/geraete/neu')
              "
              class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
              @click="router.push(`/geraete/neu?nummer=${encodeURIComponent(ergebnis.code)}`)"
            >
              Gerät mit dieser Nummer anlegen
            </button>
          </div>
        </div>
      </template>

      <button class="pt-btn pt-btn--breit pt-btn--gross weiter" @click="weiterScannen">
        <Symbol name="scan" :groesse="20" />
        Nächstes Gerät scannen
      </button>
    </div>

    <!-- ── Gesammelte Geräte ──────────────────────────────── -->
    <section v-if="gesammelt.length && darfBuchen" class="sammlung">
      <h2 class="pt-mikro sammlung__titel">
        {{ gesammelt.length }} Gerät{{ gesammelt.length === 1 ? "" : "e" }} gesammelt
      </h2>

      <ul class="pt-liste sammlung__liste">
        <li v-for="g in gesammelt" :key="g!.id" class="sammlung__zeile">
          <div class="pt-zeile__haupt">
            <div class="pt-zeile__titel">{{ g!.bezeichnung }}</div>
            <div class="pt-zeile__unter pt-mono">{{ g!.inventarnummer }}</div>
          </div>
          <StatusChip :status="g!.status" />
          <button
            class="pt-btn pt-btn--still kleinknopf"
            :aria-label="`${g!.bezeichnung} aus der Liste nehmen`"
            @click="bestand.entsammle(g!.id)"
          >
            Entfernen
          </button>
        </li>
      </ul>

      <div class="sammlung__knoepfe">
        <button class="pt-btn pt-btn--primaer pt-btn--breit" @click="sammelBuchen('ausgabe')">
          Ausgeben
        </button>
        <button class="pt-btn pt-btn--breit" @click="sammelBuchen('ruecknahme')">
          Zurücknehmen
        </button>
        <button class="pt-btn pt-btn--breit" @click="sammelBuchen('umbuchung')">Umbuchen</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scan {
  display: flex;
  flex-direction: column;
}

/* ── Sucher ─────────────────────────────────────────────── */
.sucher {
  position: relative;
  background: #000;
  aspect-ratio: 3 / 4;
  max-height: 46dvh;
  overflow: hidden;
}
@media (min-width: 720px) {
  .sucher {
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-xl);
    margin: var(--space-4) var(--space-4) 0;
  }
}

/*
 * Ohne Kamera bleibt nur die Meldung stehen. Das Seitenverhältnis muss dafür
 * weichen — sonst hielte der leere schwarze Block seine 46dvh, egal was
 * darin steht.
 */
.sucher--ohne-kamera {
  aspect-ratio: auto;
  max-height: none;
}
.sucher--ohne-kamera .sucher__bild,
.sucher--ohne-kamera .sucher__rahmen {
  display: none;
}
.sucher--ohne-kamera .sucher__meldung {
  position: static;
  background: transparent;
}

.sucher__bild {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sucher__rahmen {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

/* Breit und flach wie ein Strichcode — führt zur richtigen Haltung. */
.sucher__fenster {
  width: 84%;
  height: 30%;
  border: 2px solid rgba(255, 255, 255, 0.95);
  border-radius: var(--radius-sm);
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.45);
}

.sucher__meldung {
  position: absolute;
  inset: auto 0 0 0;
  padding: var(--space-3) var(--space-4);
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: #fff;
  text-align: center;
  background: rgba(0, 0, 0, 0.72);
}

.sucher__knoepfe {
  position: absolute;
  top: var(--space-3);
  right: var(--space-3);
  display: flex;
  gap: var(--space-2);
}

.rundknopf {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--tippziel);
  height: var(--tippziel);
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius-full);
  cursor: pointer;
}
.rundknopf--an {
  color: var(--ink);
  background: #fff;
}

/* ── Handeingabe ────────────────────────────────────────── */
.hand {
  padding: var(--space-4);
}
.hand__zeile {
  display: flex;
  gap: var(--space-2);
}
.hand__feld {
  flex: 1;
  font-size: var(--fs-20);
  letter-spacing: 0.06em;
}
.hand__vorschlaege {
  margin-top: var(--space-3);
}

/* ── Ergebnis ───────────────────────────────────────────── */
.ergebnis {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.warnungen {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.warn {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
.warn svg {
  flex: none;
  margin-top: 1px;
}

.karte {
  padding: var(--space-4);
}
.karte__kopf {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.karte__titel {
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
}
.karte__satz {
  font-size: var(--fs-15);
  color: var(--fg-body);
}
.karte__satz strong {
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.karte__hinweis {
  margin-top: var(--space-3);
}
.karte__aktionen {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.weiter {
  gap: var(--space-2);
}
.scan__meldung {
  margin: var(--space-4);
}
.sammelleiste {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.sammelschalter {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 48px Tippziel — wie überall (siehe AP20). */
  min-height: 48px;
  cursor: pointer;
}
.sammelschalter__feld {
  width: 22px;
  height: 22px;
}
.sammelschalter__text {
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
}
.sammlung {
  padding: var(--space-3) var(--space-4) var(--space-5);
}
.sammlung__titel {
  margin-bottom: var(--space-2);
}
.sammlung__liste {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-3);
}
.sammlung__zeile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.sammlung__knoepfe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.kleinknopf {
  font-size: var(--fs-12);
  padding: var(--space-1) var(--space-2);
}
</style>
