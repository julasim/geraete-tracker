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

const liste = computed(() => bestand.suche(suchtext.value));
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
});

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
