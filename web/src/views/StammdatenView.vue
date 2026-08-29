<script setup lang="ts">
/**
 * Schlagworte und Prüfarten pflegen.
 *
 * Beides gab es serverseitig seit AP4 bzw. AP8, ohne dass eine Ansicht es
 * aufrief — dieselbe Lücke wie bei den Standorten. Prüfarten braucht man
 * einmal beim Einrichten, Schlagworte wachsen mit dem Bestand.
 *
 * Bewusst eine gemeinsame Ansicht: Zwei getrennte Menüpunkte für zwei kurze
 * Listen wären mehr Navigation als Inhalt.
 */
import { computed, onMounted, ref } from "vue";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Pruefart, Schlagwort } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import Symbol from "@/components/Symbol.vue";

const bestand = useBestand();
const anmeldung = useAnmeldung();

const darfStammdaten = computed(() => anmeldung.darf("stammdaten.pflegen"));
const darfPruefarten = computed(() => anmeldung.darf("pruefungen.eintragen"));

// ── Schlagworte ────────────────────────────────────────────────────────────

const wortNeu = ref("");
const wortLaeuft = ref(false);
const wortFehler = ref<string | null>(null);
/** Welches Schlagwort wird gerade umbenannt? */
const wortBearbeitet = ref<string | null>(null);
const wortName = ref("");

const worte = computed(() =>
  [...bestand.schlagworte].sort((a, b) => a.name.localeCompare(b.name, "de")),
);

/** Wie oft ist ein Schlagwort vergeben? Entscheidet über das Löschen. */
function wortAnzahl(id: string): number {
  return bestand.geraete.filter((g) => g.schlagworte?.some((w) => w.id === id)).length;
}

async function wortAnlegen(): Promise<void> {
  const name = wortNeu.value.trim();
  if (wortLaeuft.value || !name) return;
  wortLaeuft.value = true;
  wortFehler.value = null;
  try {
    bestand.ergaenzeSchlagwort(await api.post<Schlagwort>("/schlagworte", { name }));
    wortNeu.value = "";
  } catch (e) {
    wortFehler.value =
      e instanceof ApiError ? e.message : "Das Schlagwort konnte nicht angelegt werden.";
  } finally {
    wortLaeuft.value = false;
  }
}

async function wortSpeichern(wort: Schlagwort): Promise<void> {
  const name = wortName.value.trim();
  if (wortLaeuft.value || !name) return;
  wortLaeuft.value = true;
  wortFehler.value = null;
  try {
    bestand.ergaenzeSchlagwort(await api.patch<Schlagwort>(`/schlagworte/${wort.id}`, { name }));
    wortBearbeitet.value = null;
  } catch (e) {
    wortFehler.value =
      e instanceof ApiError ? e.message : "Die Änderung konnte nicht gespeichert werden.";
  } finally {
    wortLaeuft.value = false;
  }
}

async function wortLoeschen(wort: Schlagwort): Promise<void> {
  const anzahl = wortAnzahl(wort.id);
  const zusatz =
    anzahl > 0
      ? `Es ist derzeit an ${anzahl} Gerät(en) vergeben und verschwindet dort.\n\n`
      : "";
  if (!confirm(`${zusatz}„${wort.name}“ löschen?`)) return;
  wortFehler.value = null;
  try {
    await api.delete(`/schlagworte/${wort.id}`);
    bestand.entferneSchlagwort(wort.id);
  } catch (e) {
    wortFehler.value =
      e instanceof ApiError ? e.message : "Das Schlagwort konnte nicht gelöscht werden.";
  }
}

// ── Prüfarten ──────────────────────────────────────────────────────────────

const arten = ref<Pruefart[]>([]);
const artName = ref("");
const artMonate = ref(12);
const artLaeuft = ref(false);
const artFehler = ref<string | null>(null);

async function artenLaden(): Promise<void> {
  try {
    arten.value = await api.get<Pruefart[]>("/pruefarten");
  } catch {
    // Ohne Anmeldung oder ohne Server: Dann steht dort nichts, statt einer
    // Fehlermeldung über eine Nebensache.
  }
}

async function artAnlegen(): Promise<void> {
  const name = artName.value.trim();
  if (artLaeuft.value || !name) return;
  artLaeuft.value = true;
  artFehler.value = null;
  try {
    const neu = await api.post<Pruefart>("/pruefarten", {
      name,
      intervall_monate: artMonate.value,
    });
    arten.value.push(neu);
    artName.value = "";
  } catch (e) {
    artFehler.value =
      e instanceof ApiError ? e.message : "Die Prüfart konnte nicht angelegt werden.";
  } finally {
    artLaeuft.value = false;
  }
}

/** Monate in Worten — „alle 12 Monate“ liest sich schlechter als „jährlich“. */
function intervallText(monate: number): string {
  if (monate === 1) return "monatlich";
  if (monate === 3) return "vierteljährlich";
  if (monate === 6) return "halbjährlich";
  if (monate === 12) return "jährlich";
  if (monate === 24) return "alle zwei Jahre";
  return `alle ${monate} Monate`;
}

onMounted(async () => {
  await bestand.laden();
  await artenLaden();
});
</script>

<template>
  <div>
    <Kopf titel="Schlagworte und Prüfarten" unter="Einteilung und Fristen" />

    <section class="block">
      <h2 class="pt-mikro abschnitt">Schlagworte</h2>
      <p class="pt-gedaempft hinweis">
        Die einzige Einteilung des Bestands. Ein Gerät kann beliebig viele tragen —
        es gibt bewusst keine festen Kategorien.
      </p>

      <div v-if="darfStammdaten" class="anlegen">
        <input
          v-model="wortNeu"
          class="pt-feld"
          maxlength="60"
          placeholder="z. B. Verdichtung"
          autocomplete="off"
          @keyup.enter="wortAnlegen"
        />
        <button
          class="pt-btn pt-btn--primaer"
          :disabled="wortLaeuft || !wortNeu.trim()"
          @click="wortAnlegen"
        >
          <Symbol name="plus" :groesse="16" /> Anlegen
        </button>
      </div>

      <p v-if="wortFehler" class="pt-meldung pt-meldung--fehler">{{ wortFehler }}</p>

      <p v-if="!worte.length" class="pt-leer">Noch keine Schlagworte.</p>
      <ul v-else class="pt-liste karte">
        <li v-for="w in worte" :key="w.id">
          <div v-if="wortBearbeitet === w.id" class="zeile bearbeiten">
            <input v-model="wortName" class="pt-feld" maxlength="60" />
            <button class="pt-btn pt-btn--still" @click="wortBearbeitet = null">Abbrechen</button>
            <button
              class="pt-btn pt-btn--primaer"
              :disabled="wortLaeuft || !wortName.trim()"
              @click="wortSpeichern(w)"
            >
              Speichern
            </button>
          </div>

          <div v-else class="zeile">
            <div class="zeile__haupt">
              <div class="pt-zeile__titel">{{ w.name }}</div>
              <div class="pt-zeile__unter">
                {{ wortAnzahl(w.id) }} Gerät(e)
              </div>
            </div>
            <template v-if="darfStammdaten">
              <button
                class="pt-btn kleinknopf"
                @click="((wortBearbeitet = w.id), (wortName = w.name))"
              >
                Umbenennen
              </button>
              <!--
                Bewusst kein roter Knopf: In einer Liste mit zwanzig Zeilen
                wären zwanzig rote Flächen untereinander lauter als alles
                andere auf der Seite, und das Auge gewöhnt sich daran. Der
                Schutz vor dem Fehlgriff ist die Rückfrage, nicht die Farbe.
                Das Projekt hält es überall so (siehe "Aus dem Bestand
                nehmen" in GeraetBearbeitenView).
              -->
              <button class="pt-btn kleinknopf" @click="wortLoeschen(w)">Löschen</button>
            </template>
          </div>
        </li>
      </ul>
    </section>

    <section class="block">
      <h2 class="pt-mikro abschnitt">Prüfarten</h2>
      <p class="pt-gedaempft hinweis">
        Wiederkehrende Prüfungen und ihr Abstand. Aus ihnen entsteht die Fristenliste;
        das Fälligkeitsdatum rechnet der Server aus der letzten Prüfung.
      </p>

      <div v-if="darfPruefarten" class="anlegen">
        <input
          v-model="artName"
          class="pt-feld"
          maxlength="80"
          placeholder="z. B. Elektroprüfung nach ÖVE"
          autocomplete="off"
        />
        <select v-model.number="artMonate" class="pt-feld monate">
          <option :value="1">monatlich</option>
          <option :value="3">vierteljährlich</option>
          <option :value="6">halbjährlich</option>
          <option :value="12">jährlich</option>
          <option :value="24">alle zwei Jahre</option>
          <option :value="36">alle drei Jahre</option>
        </select>
        <button
          class="pt-btn pt-btn--primaer"
          :disabled="artLaeuft || !artName.trim()"
          @click="artAnlegen"
        >
          <Symbol name="plus" :groesse="16" /> Anlegen
        </button>
      </div>

      <p v-if="artFehler" class="pt-meldung pt-meldung--fehler">{{ artFehler }}</p>

      <p v-if="!arten.length" class="pt-leer">Noch keine Prüfarten.</p>
      <ul v-else class="pt-liste karte">
        <li v-for="a in arten" :key="a.id">
          <div class="zeile">
            <div class="zeile__haupt">
              <div class="pt-zeile__titel">{{ a.name }}</div>
              <div class="pt-zeile__unter">{{ intervallText(a.intervall_monate) }}</div>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.block {
  padding: 0 var(--space-4) var(--space-6);
}
.abschnitt {
  margin: var(--space-5) 0 var(--space-2);
}
.hinweis {
  font-size: var(--fs-13);
  margin-bottom: var(--space-3);
}
.anlegen {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.anlegen .pt-feld {
  flex: 1 1 12rem;
}
.monate {
  flex: 0 1 12rem;
}
.karte {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.zeile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
}
.zeile__haupt {
  flex: 1;
  min-width: 0;
}
.bearbeiten .pt-feld {
  flex: 1;
}
.kleinknopf {
  font-size: var(--fs-12);
  padding: var(--space-1) var(--space-2);
}
</style>
