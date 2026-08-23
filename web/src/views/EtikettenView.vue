<script setup lang="ts">
/**
 * Etiketten drucken.
 *
 * Der wichtigste Teil dieser Seite ist der Hinweis zur Druckeinstellung.
 * Der Standardfall im Browser ist "an Seite anpassen", und damit schrumpft
 * der Barcode um 3 bis 5 % — genug, dass ihn die Kamera nicht mehr liest.
 * Das merkt man erst, wenn 200 Etiketten kleben.
 *
 * Deshalb auch der Testbogen: erst vier Stück drucken, kleben, scannen,
 * und dann der große Lauf.
 */
import { computed, onMounted, ref } from "vue";
import { api } from "@/api";
import { useBestand } from "@/stores/bestand";
import Kopf from "@/components/Kopf.vue";
import Symbol from "@/components/Symbol.vue";

const bestand = useBestand();

interface FormatInfo {
  schluessel: string;
  name: string;
  proBogen: number;
}

const formate = ref<FormatInfo[]>([]);
const format = ref("70x37");
const firmenname = ref("");
const gewaehlt = ref<Set<string>>(new Set());
const startPosition = ref(0);
const suchtext = ref("");
const laeuft = ref(false);
const fehler = ref<string | null>(null);

/** Wie viele Etiketten auf Vorrat gedruckt werden sollen. */
const vorratAnzahl = ref(24);
const vorratLaeuft = ref(false);
const vorratErgebnis = ref<string | null>(null);

interface Nummernstand {
  vergeben: number;
  reserviert: number;
  gesehen: number;
  hoechste: string | null;
  offen: { nummer: string }[];
}
const stand = ref<Nummernstand | null>(null);

const naechsteNummer = computed(() =>
  stand.value?.hoechste
    ? String(Number(stand.value.hoechste) + 1).padStart(stand.value.hoechste.length, "0")
    : "10001",
);

const liste = computed(() => bestand.suche(suchtext.value));

/**
 * Regalplätze — der zweite Nummernkreis.
 *
 * Bewusst eine getrennte Auswahl und ein getrennter Knopf: Geräte-Etiketten
 * (Ziffern) und Regal-Etiketten (P-…) sind in dieser Anwendung durchgängig
 * getrennt, bis hinunter in zwei CHECK-Constraints der Datenbank. Ein
 * gemeinsamer Bogen wäre die erste Stelle, an der sie wieder zusammenliefen.
 */
const plaetze = computed(() => bestand.lagerplaetze.filter((p) => p.aktiv && p.barcode));
const gewaehlteePlaetze = ref<Set<string>>(new Set());
const platzLaeuft = ref(false);

const platzAnzahl = computed(() => gewaehlteePlaetze.value.size);

function platzUmschalten(id: string): void {
  const neu = new Set(gewaehlteePlaetze.value);
  if (neu.has(id)) neu.delete(id);
  else neu.add(id);
  gewaehlteePlaetze.value = neu;
}

async function regaleDrucken(): Promise<void> {
  if (!platzAnzahl.value || platzLaeuft.value) return;
  platzLaeuft.value = true;
  fehler.value = null;
  try {
    const antwort = await fetch("/api/etiketten/lagerplaetze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        lagerplaetze: [...gewaehlteePlaetze.value],
        format: format.value,
        startPosition: startPosition.value,
      }),
    });
    if (!antwort.ok) {
      const daten = await antwort.json().catch(() => ({}));
      throw new Error(daten.error ?? "Die Etiketten konnten nicht erzeugt werden");
    }
    window.open(URL.createObjectURL(await antwort.blob()), "_blank");
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Die Etiketten konnten nicht erzeugt werden";
  } finally {
    platzLaeuft.value = false;
  }
}
const anzahl = computed(() => gewaehlt.value.size);
const proBogen = computed(
  () => formate.value.find((f) => f.schluessel === format.value)?.proBogen ?? 24,
);
const boegen = computed(() => Math.ceil((anzahl.value + startPosition.value) / proBogen.value));

onMounted(async () => {
  await bestand.laden();
  try {
    const antwort = await api.get<{
      formate: FormatInfo[];
      voreinstellung: string;
      firmenname: string;
    }>("/etiketten/formate");
    formate.value = antwort.formate;
    format.value = antwort.voreinstellung;
    firmenname.value = antwort.firmenname;
  } catch {
    // Die Auswahl ist Beiwerk — ohne sie greift die Voreinstellung.
  }
  await ladeStand();
});

async function ladeStand(): Promise<void> {
  try {
    stand.value = await api.get<Nummernstand>("/etiketten/nummern");
  } catch {
    stand.value = null;
  }
}

/**
 * Etiketten auf Vorrat: neue Nummern erzeugen und drucken.
 *
 * Die Nummern sind ab dem Druck verbraucht — auch wenn der Bogen im
 * Papierkorb landet. Das ist Absicht: Eine verlorene Nummer kostet nichts,
 * eine doppelt geklebte kostet die Verlässlichkeit des ganzen Bestands.
 */
async function vorratDrucken(): Promise<void> {
  if (vorratLaeuft.value) return;
  if (!confirm(
    `${vorratAnzahl.value} neue Nummern ab ${naechsteNummer.value} erzeugen und drucken?

` +
      "Diese Nummern sind danach vergeben und werden nie erneut ausgegeben.",
  )) return;

  vorratLaeuft.value = true;
  fehler.value = null;
  vorratErgebnis.value = null;
  try {
    const antwort = await fetch("/api/etiketten/vorrat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        anzahl: vorratAnzahl.value,
        format: format.value,
        startPosition: startPosition.value,
      }),
    });
    if (!antwort.ok) {
      const daten = await antwort.json().catch(() => ({}));
      throw new Error(daten.error ?? "Der Vorratsbogen konnte nicht erzeugt werden");
    }
    const von = antwort.headers.get("X-Nummern-Von");
    const bis = antwort.headers.get("X-Nummern-Bis");
    vorratErgebnis.value = `${von} bis ${bis} — gedruckt und reserviert.`;
    window.open(URL.createObjectURL(await antwort.blob()), "_blank");
    await ladeStand();
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Der Vorratsbogen konnte nicht erzeugt werden";
  } finally {
    vorratLaeuft.value = false;
  }
}

function umschalten(id: string): void {
  const neu = new Set(gewaehlt.value);
  if (neu.has(id)) neu.delete(id);
  else neu.add(id);
  gewaehlt.value = neu;
}

function alleSichtbaren(): void {
  gewaehlt.value = new Set(liste.value.map((g) => g.id));
}

function keine(): void {
  gewaehlt.value = new Set();
}

/**
 * Öffnet das PDF in einem neuen Fenster.
 *
 * Bewusst kein automatischer Druckdialog: Der Benutzer soll den Bogen
 * zuerst ansehen und dann selbst drucken — mit der richtigen Einstellung.
 */
async function drucken(): Promise<void> {
  if (!anzahl.value || laeuft.value) return;
  laeuft.value = true;
  fehler.value = null;
  try {
    const antwort = await fetch("/api/etiketten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        geraete: [...gewaehlt.value],
        format: format.value,
        startPosition: startPosition.value,
      }),
    });
    if (!antwort.ok) {
      const daten = await antwort.json().catch(() => ({}));
      throw new Error(daten.error ?? "Die Etiketten konnten nicht erzeugt werden");
    }
    const brocken = await antwort.blob();
    window.open(URL.createObjectURL(brocken), "_blank");
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Die Etiketten konnten nicht erzeugt werden";
  } finally {
    laeuft.value = false;
  }
}
</script>

<template>
  <div>
    <Kopf titel="Etiketten drucken" zurueck />

    <div class="inhalt">
      <!-- Der Hinweis steht oben, nicht unten: Er entscheidet darüber,
           ob die gedruckten Etiketten hinterher funktionieren. -->
      <div class="pt-meldung pt-meldung--warnung wichtig">
        <Symbol name="warnung" :groesse="18" />
        <div>
          <strong>Vor dem Drucken: Skalierung auf 100 % stellen.</strong>
          Im Druckdialog „Tatsächliche Größe" wählen, nicht „An Seite anpassen".
          Sonst schrumpft der Barcode um einige Prozent und lässt sich später
          nicht mehr scannen.
        </div>
      </div>

      <section>
        <h2 class="pt-mikro abschnitt">Zuerst ausprobieren</h2>
        <div class="pt-karte block">
          <p class="text">
            Ein Bogen mit vier Etiketten zum Ausprobieren. Drucken, ausschneiden,
            auf ein Gerät kleben und mit der App scannen — erst wenn das klappt,
            lohnt der große Lauf.
          </p>
          <a
            class="pt-btn pt-btn--breit"
            :href="`/api/etiketten/testbogen?format=${format}`"
            target="_blank"
            rel="noopener"
          >
            Testbogen öffnen
          </a>
        </div>
      </section>

      <section>
        <h2 class="pt-mikro abschnitt">Neue Etiketten auf Vorrat</h2>
        <div class="pt-karte block">
          <p class="text">
            Für Geräte, die noch nicht erfasst sind: Bogen drucken, aufkleben,
            später in Ruhe erfassen. Die Nummern werden dabei <strong>sofort
            reserviert</strong> und nie ein zweites Mal vergeben.
          </p>

          <div v-if="stand" class="stand">
            <div class="stand__zeile">
              <span>Nächste freie Nummer</span>
              <strong class="pt-mono">{{ naechsteNummer }}</strong>
            </div>
            <div class="stand__zeile">
              <span>Vergeben</span><strong>{{ stand.vergeben }}</strong>
            </div>
            <div v-if="stand.reserviert" class="stand__zeile">
              <span>Gedruckt, noch nicht erfasst</span>
              <strong>{{ stand.reserviert }}</strong>
            </div>
            <div v-if="stand.gesehen" class="stand__zeile">
              <span>Beim Scannen aufgetaucht</span>
              <strong>{{ stand.gesehen }}</strong>
            </div>
          </div>

          <div class="feld">
            <label class="pt-label" for="anzahl">Wie viele Etiketten?</label>
            <input
              id="anzahl"
              v-model.number="vorratAnzahl"
              class="pt-feld"
              type="number"
              min="1"
              max="500"
            />
          </div>

          <p v-if="vorratErgebnis" class="pt-meldung">{{ vorratErgebnis }}</p>

          <button
            class="pt-btn pt-btn--primaer pt-btn--breit"
            :disabled="vorratLaeuft || vorratAnzahl < 1"
            @click="vorratDrucken"
          >
            {{ vorratLaeuft ? "Wird erzeugt …" : `${vorratAnzahl} Etiketten drucken` }}
          </button>
        </div>
      </section>

      <section>
        <h2 class="pt-mikro abschnitt">Bogen</h2>
        <div class="pt-karte block">
          <div class="feld">
            <label class="pt-label" for="format">Etikettenbogen</label>
            <select id="format" v-model="format" class="pt-feld">
              <option v-for="f in formate" :key="f.schluessel" :value="f.schluessel">
                {{ f.name }}
              </option>
            </select>
          </div>

          <div class="feld">
            <label class="pt-label" for="start">Erstes freies Etikett auf dem Bogen</label>
            <input
              id="start"
              v-model.number="startPosition"
              class="pt-feld"
              type="number"
              min="0"
              :max="proBogen - 1"
            />
            <p class="hinweis">
              Für angebrochene Bögen: 0 heißt links oben. Sind schon fünf Etiketten
              abgezogen, hier 5 eintragen.
            </p>
          </div>

          <p v-if="firmenname" class="hinweis">
            Auf jedem Etikett steht: <strong>{{ firmenname }}</strong>
          </p>
        </div>
      </section>

      <section>
        <h2 class="pt-mikro abschnitt">Geräte auswählen</h2>

        <div class="werkzeuge">
          <input
            v-model="suchtext"
            class="pt-feld"
            type="search"
            placeholder="Suchen …"
            autocapitalize="off"
          />
          <div class="reihe">
            <button class="pt-btn" @click="alleSichtbaren">Alle {{ liste.length }}</button>
            <button class="pt-btn" :disabled="!anzahl" @click="keine">Keine</button>
          </div>
        </div>

        <ul class="pt-karte pt-liste auswahl">
          <li v-for="g in liste" :key="g.id">
            <button class="pt-zeile" @click="umschalten(g.id)">
              <span class="haken" :class="{ 'haken--an': gewaehlt.has(g.id) }" aria-hidden="true">
                <Symbol v-if="gewaehlt.has(g.id)" name="haken" :groesse="16" />
              </span>
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
              </div>
            </button>
          </li>
        </ul>
      </section>

      <section v-if="plaetze.length">
        <h2 class="pt-mikro abschnitt">Regalplätze auswählen</h2>
        <p class="pt-gedaempft hinweis regalhinweis">
          Eigener Bogen, eigener Knopf: Regal-Kennungen beginnen mit
          <span class="pt-mono">P-</span> und dürfen nie zwischen die
          Gerätenummern geraten.
        </p>

        <ul class="pt-karte pt-liste auswahl">
          <li v-for="pl in plaetze" :key="pl.id">
            <button class="pt-zeile" @click="platzUmschalten(pl.id)">
              <span
                class="haken"
                :class="{ 'haken--an': gewaehlteePlaetze.has(pl.id) }"
                aria-hidden="true"
              >
                <Symbol v-if="gewaehlteePlaetze.has(pl.id)" name="haken" :groesse="16" />
              </span>
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ pl.bezeichnung }}</div>
                <div class="pt-zeile__unter pt-mono">{{ pl.barcode ?? "ohne Kennung" }}</div>
              </div>
            </button>
          </li>
        </ul>

        <div class="regalknopf">
          <button
            class="pt-btn pt-btn--breit"
            :disabled="!platzAnzahl || platzLaeuft"
            @click="regaleDrucken"
          >
            {{
              platzLaeuft
                ? "Wird erzeugt …"
                : `${platzAnzahl} Regal-Etikett${platzAnzahl === 1 ? "" : "en"} öffnen`
            }}
          </button>
        </div>
      </section>

      <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>
    </div>

    <!-- Bleibt am unteren Rand stehen, damit man beim Auswählen sieht,
         wie viele Bögen es werden. -->
    <div v-if="anzahl" class="fussleiste">
      <div class="fussleiste__text">
        {{ anzahl }} Etikett{{ anzahl === 1 ? "" : "en" }} ·
        {{ boegen }} Bogen{{ boegen === 1 ? "" : "" }}
      </div>
      <button class="pt-btn pt-btn--primaer" :disabled="laeuft" @click="drucken">
        {{ laeuft ? "Wird erzeugt …" : "PDF öffnen" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.regalhinweis {
  padding: 0 var(--space-4) var(--space-2);
}
.regalknopf {
  padding: var(--space-3) var(--space-4) 0;
}

.stand {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-4);
  background: var(--surface-subtle);
}
.stand__zeile {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.stand__zeile:last-child { border-bottom: 0; }
.stand__zeile strong { color: var(--fg); font-variant-numeric: tabular-nums; }

.inhalt {
  padding: var(--space-4);
  padding-bottom: calc(var(--leiste-hoehe) + 80px);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.wichtig {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  font-size: var(--fs-14);
  line-height: var(--lh-normal);
}
.wichtig svg {
  flex: none;
  margin-top: 2px;
}

.abschnitt {
  margin-bottom: var(--space-2);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}

.text {
  font-size: var(--fs-14);
  line-height: var(--lh-normal);
  color: var(--fg-body);
}

.feld {
  display: flex;
  flex-direction: column;
}

.hinweis {
  margin-top: var(--space-2);
  font-size: var(--fs-13);
  line-height: var(--lh-normal);
  color: var(--fg-muted);
}
.hinweis strong {
  color: var(--fg);
}

.werkzeuge {
  margin-bottom: var(--space-3);
}
.reihe {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.reihe .pt-btn {
  flex: 1;
  min-height: 40px;
  font-size: var(--fs-13);
}

.auswahl {
  max-height: 50dvh;
  overflow-y: auto;
}

.haken {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  color: var(--accent-fg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.haken--an {
  background: var(--accent);
  border-color: var(--accent);
}

.fussleiste {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--leiste-hoehe) + env(safe-area-inset-bottom));
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.fussleiste__text {
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
</style>
