<script setup lang="ts">
/**
 * Bestand aus- und einlesen.
 *
 * Der Ablauf ist bewusst zweistufig: erst prüfen, dann schreiben. Die
 * Vorschau zeigt Zeile für Zeile, was passieren würde — und schreibt dabei
 * garantiert nichts. Erst danach gibt es den Knopf, der es tatsächlich tut.
 */
import { computed, ref } from "vue";
import { useBestand } from "@/stores/bestand";
import Kopf from "@/components/Kopf.vue";
import Symbol from "@/components/Symbol.vue";

interface GepruefteZeile {
  nummer: number;
  art: "neu" | "geaendert" | "unveraendert" | "konflikt" | "fehler";
  inventarnummer: string | null;
  bezeichnung: string;
  aenderungen: { feld: string; alt: string; neu: string }[];
  meldung?: string;
}

interface Vorschau {
  zeilen: GepruefteZeile[];
  neu: number;
  geaendert: number;
  unveraendert: number;
  konflikte: number;
  fehler: number;
  neueSchlagworte: string[];
  schreibbar: boolean;
  hinweise: string[];
  gelesen: number;
  spalten: string[];
  trennzeichen: string;
}

const bestand = useBestand();

const dateiEl = ref<HTMLInputElement | null>(null);
const gewaehlteDatei = ref<File | null>(null);
const vorschau = ref<Vorschau | null>(null);
const laeuft = ref(false);
const fehler = ref<string | null>(null);
const fertig = ref<{ angelegt: number; geaendert: number; uebersprungen: number } | null>(null);

const FELD_TEXT: Record<string, string> = {
  bezeichnung: "Bezeichnung",
  hersteller: "Hersteller",
  modell: "Modell",
  seriennummer: "Seriennummer",
  anschaffungsdatum: "Anschaffungsdatum",
  anschaffungswert: "Anschaffungswert",
  betriebsstunden: "Betriebsstunden",
  notiz: "Notiz",
  schlagworte: "Schlagworte",
};

/** Nur das, was der Benutzer wirklich sehen muss — Unverändertes nicht. */
const auffaellig = computed(
  () => vorschau.value?.zeilen.filter((z) => z.art !== "unveraendert") ?? [],
);

function dateiGewaehlt(ereignis: Event): void {
  const eingabe = ereignis.target as HTMLInputElement;
  gewaehlteDatei.value = eingabe.files?.[0] ?? null;
  vorschau.value = null;
  fertig.value = null;
  fehler.value = null;
  if (gewaehlteDatei.value) void pruefen();
}

async function pruefen(): Promise<void> {
  if (!gewaehlteDatei.value || laeuft.value) return;
  laeuft.value = true;
  fehler.value = null;
  try {
    const formular = new FormData();
    formular.append("datei", gewaehlteDatei.value);
    const antwort = await fetch("/api/import/geraete/pruefen", {
      method: "POST",
      body: formular,
      credentials: "same-origin",
    });
    const daten = await antwort.json();
    if (!antwort.ok) throw new Error(daten.error ?? "Die Datei konnte nicht gelesen werden");
    vorschau.value = daten as Vorschau;
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Die Datei konnte nicht gelesen werden";
  } finally {
    laeuft.value = false;
  }
}

async function importieren(): Promise<void> {
  if (!gewaehlteDatei.value || !vorschau.value?.schreibbar || laeuft.value) return;
  laeuft.value = true;
  fehler.value = null;
  try {
    const formular = new FormData();
    formular.append("datei", gewaehlteDatei.value);
    const antwort = await fetch("/api/import/geraete", {
      method: "POST",
      body: formular,
      credentials: "same-origin",
    });
    const daten = await antwort.json();
    if (!antwort.ok) throw new Error(daten.error ?? "Der Import ist fehlgeschlagen");

    fertig.value = daten;
    vorschau.value = null;
    gewaehlteDatei.value = null;
    if (dateiEl.value) dateiEl.value.value = "";
    await bestand.laden(true);
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Der Import ist fehlgeschlagen";
  } finally {
    laeuft.value = false;
  }
}

/** Wie eine Zeilenart heißt und aussieht. */
function artText(art: string): string {
  const texte: Record<string, string> = {
    neu: "Neu",
    geaendert: "Ändert sich",
    konflikt: "Konflikt",
    fehler: "Fehler",
  };
  return texte[art] ?? art;
}

function chipArt(art: string): string {
  const arten: Record<string, string> = {
    neu: "verfuegbar",
    geaendert: "ausgegeben",
    konflikt: "wartung",
    fehler: "defekt",
  };
  return arten[art] ?? "neutral";
}

function abbrechen(): void {
  vorschau.value = null;
  gewaehlteDatei.value = null;
  fehler.value = null;
  if (dateiEl.value) dateiEl.value.value = "";
}
</script>

<template>
  <div>
    <Kopf titel="Import und Export" zurueck />

    <div class="inhalt">
      <!-- ── Export ─────────────────────────────────────── -->
      <section>
        <h2 class="pt-mikro abschnitt">Export</h2>
        <div class="pt-karte block">
          <p class="text">
            Lädt den gesamten Bestand als Tabelle herunter — {{ bestand.geraete.length }} Geräte.
            Die Datei öffnet sich in Excel und lässt sich nach dem Bearbeiten wieder einlesen.
          </p>
          <a class="pt-btn pt-btn--breit" href="/api/export/geraete.csv" download>
            Bestand herunterladen
          </a>
        </div>
      </section>

      <!-- ── Import ─────────────────────────────────────── -->
      <section>
        <h2 class="pt-mikro abschnitt">Import</h2>

        <div v-if="fertig" class="pt-meldung pt-meldung--erfolg">
          <strong>Import abgeschlossen.</strong><br />
          {{ fertig.angelegt }} Geräte angelegt, {{ fertig.geaendert }} geändert,
          {{ fertig.uebersprungen }} unverändert.
        </div>

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <div v-if="!vorschau" class="pt-karte block">
          <p class="text">
            Es zählt nur die Spalte <strong>Bezeichnung</strong> — alles andere darf fehlen
            oder leer bleiben. Eine leere Zelle bei einem vorhandenen Gerät ändert nichts;
            zum Löschen eines Werts trägt man einen Bindestrich ein.
          </p>
          <input
            ref="dateiEl"
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            @change="dateiGewaehlt"
          />
          <button class="pt-btn pt-btn--breit" :disabled="laeuft" @click="dateiEl?.click()">
            {{ laeuft ? "Wird geprüft …" : "Datei auswählen" }}
          </button>
        </div>

        <!-- ── Vorschau ─────────────────────────────────── -->
        <template v-if="vorschau">
          <div class="pt-karte block">
            <p class="pt-mikro">Vorschau — es wurde noch nichts geändert</p>

            <div class="zahlen">
              <div class="zahl">
                <span class="zahl__wert">{{ vorschau.neu }}</span>
                <span class="zahl__text">neu</span>
              </div>
              <div class="zahl">
                <span class="zahl__wert">{{ vorschau.geaendert }}</span>
                <span class="zahl__text">geändert</span>
              </div>
              <div class="zahl">
                <span class="zahl__wert">{{ vorschau.unveraendert }}</span>
                <span class="zahl__text">unverändert</span>
              </div>
              <div class="zahl" :class="{ 'zahl--schlecht': vorschau.fehler + vorschau.konflikte > 0 }">
                <span class="zahl__wert">{{ vorschau.fehler + vorschau.konflikte }}</span>
                <span class="zahl__text">Probleme</span>
              </div>
            </div>

            <p class="pt-gedaempft datei">
              {{ vorschau.gelesen }} Zeilen gelesen · Trennzeichen
              <code>{{ vorschau.trennzeichen }}</code>
            </p>

            <p v-for="(h, i) in vorschau.hinweise" :key="i" class="pt-meldung pt-meldung--hinweis hinweis">
              {{ h }}
            </p>
          </div>

          <!-- Probleme zuerst: sie verhindern den Import. -->
          <div v-if="!vorschau.schreibbar" class="pt-meldung pt-meldung--fehler">
            <strong>Der Import wird nicht ausgeführt.</strong>
            <template v-if="vorschau.fehler">
              {{ vorschau.fehler }} Zeile(n) sind fehlerhaft.
            </template>
            <template v-if="vorschau.konflikte">
              {{ vorschau.konflikte }} Gerät(e) wurden nach dem Export in der App geändert —
              ein Import würde diese Änderungen überschreiben.
            </template>
            Bitte die Datei berichtigen und erneut auswählen. Es wurde nichts geändert.
          </div>

          <ul v-if="auffaellig.length" class="pt-karte pt-liste zeilen">
            <li v-for="z in auffaellig.slice(0, 80)" :key="z.nummer">
              <div class="zeile">
                <div class="zeile__kopf">
                  <span class="pt-chip" :class="`pt-chip--${chipArt(z.art)}`">{{ artText(z.art) }}</span>
                  <span class="pt-gedaempft">Zeile {{ z.nummer }}</span>
                  <span v-if="z.inventarnummer" class="pt-mono pt-gedaempft">{{ z.inventarnummer }}</span>
                </div>
                <div class="zeile__titel">{{ z.bezeichnung || "(ohne Bezeichnung)" }}</div>
                <p v-if="z.meldung" class="zeile__meldung">{{ z.meldung }}</p>
                <ul v-if="z.aenderungen.length" class="aender">
                  <li v-for="a in z.aenderungen" :key="a.feld">
                    <span class="aender__feld">{{ FELD_TEXT[a.feld] ?? a.feld }}:</span>
                    <span class="aender__alt">{{ a.alt || "—" }}</span>
                    <Symbol name="zurueck" :groesse="14" class="aender__pfeil" />
                    <span class="aender__neu">{{ a.neu || "—" }}</span>
                  </li>
                </ul>
              </div>
            </li>
          </ul>
          <p v-if="auffaellig.length > 80" class="pt-gedaempft mehr">
            … und {{ auffaellig.length - 80 }} weitere
          </p>

          <div class="knoepfe">
            <button
              class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
              :disabled="!vorschau.schreibbar || laeuft"
              @click="importieren"
            >
              {{
                laeuft
                  ? "Wird importiert …"
                  : `${vorschau.neu + vorschau.geaendert} Änderungen übernehmen`
              }}
            </button>
            <button class="pt-btn pt-btn--breit" @click="abbrechen">Abbrechen</button>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inhalt {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
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
.text strong {
  color: var(--fg);
}

.zahlen {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}
.zahl {
  padding: var(--space-2);
  text-align: center;
  background: var(--surface-muted);
  border-radius: var(--radius-md);
}
.zahl__wert {
  display: block;
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
  color: var(--fg);
}
.zahl__text {
  font-size: var(--fs-11);
  color: var(--fg-muted);
}
.zahl--schlecht .zahl__wert {
  color: var(--danger-fg);
}

.datei {
  font-size: var(--fs-12);
}
.datei code {
  padding: 1px 4px;
  background: var(--surface-muted);
  border-radius: var(--radius-xs);
}

.hinweis {
  font-size: var(--fs-13);
}

.zeilen {
  max-height: 60dvh;
  overflow-y: auto;
}

.zeile {
  padding: var(--space-3) var(--space-4);
}
.zeile__kopf {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-12);
  margin-bottom: var(--space-1);
}
.zeile__titel {
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.zeile__meldung {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
  color: var(--danger-fg);
}

.aender {
  list-style: none;
  margin: var(--space-2) 0 0;
  padding: 0;
  font-size: var(--fs-13);
}
.aender li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  padding: 2px 0;
}
.aender__feld {
  color: var(--fg-muted);
}
.aender__alt {
  color: var(--fg-muted);
  text-decoration: line-through;
}
.aender__pfeil {
  transform: rotate(180deg);
  color: var(--fg-subtle);
}
.aender__neu {
  font-weight: var(--fw-medium);
  color: var(--fg);
}

.mehr {
  font-size: var(--fs-13);
  text-align: center;
}

.knoepfe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
</style>
