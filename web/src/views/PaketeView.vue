<script setup lang="ts">
/**
 * Pakete — benannte Zusammenstellungen, die gemeinsam hinausgehen.
 *
 * Für eine Estrich-Baustelle fahren immer dieselben acht Geräte mit. Wer sie
 * jedes Mal einzeln zusammensucht, vergisst eines — und merkt es auf der
 * Baustelle.
 *
 * **Ein Paket hält keinen Bestand.** Es zeigt nur auf Geräte; wo etwas steht,
 * sagt allein das Gerät. Beim Ausgeben füllt es die Sammelliste — was gerade
 * nicht mitfährt, wird dort abgewählt. Verbindlich ist immer, was tatsächlich
 * gebucht wird.
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Paket, PaketGeraet } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";

const router = useRouter();
const bestand = useBestand();
const anmeldung = useAnmeldung();

const darfPflegen = computed(() => anmeldung.darf("stammdaten.pflegen"));

const pakete = ref<Paket[]>([]);
const laedt = ref(true);
const fehler = ref<string | null>(null);

/** Welches Paket ist aufgeklappt, und was steckt darin? */
const offen = ref<string | null>(null);
const inhalt = ref<Record<string, PaketGeraet[]>>({});

const neuOffen = ref(false);
const neuName = ref("");
const speichert = ref(false);
const nameEl = ref<HTMLInputElement | null>(null);

/** Geräte zum Zuordnen suchen — dieselbe Suche wie im Bestand. */
const suchtext = ref("");
const treffer = computed(() =>
  suchtext.value.trim().length >= 2 ? bestand.suche(suchtext.value).slice(0, 8) : [],
);

async function laden(): Promise<void> {
  laedt.value = true;
  try {
    pakete.value = await api.get<Paket[]>("/pakete");
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Die Pakete konnten nicht geladen werden.";
  } finally {
    laedt.value = false;
  }
}

async function umschalten(id: string): Promise<void> {
  if (offen.value === id) {
    offen.value = null;
    return;
  }
  offen.value = id;
  suchtext.value = "";
  if (!inhalt.value[id]) {
    inhalt.value[id] = await api.get<PaketGeraet[]>(`/pakete/${id}/geraete`);
  }
}

async function anlegen(): Promise<void> {
  const name = neuName.value.trim();
  if (speichert.value || !name) return;
  speichert.value = true;
  fehler.value = null;
  try {
    const neu = await api.post<Paket>("/pakete", { name });
    pakete.value.push(neu);
    pakete.value.sort((a, b) => a.name.localeCompare(b.name, "de"));
    neuName.value = "";
    // Direkt aufklappen: Ein leeres Paket will sofort befüllt werden.
    await umschalten(neu.id);
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Das Paket konnte nicht angelegt werden.";
  } finally {
    speichert.value = false;
  }
}

/** Schreibt die Geräteliste eines Pakets — der Server ersetzt sie ganz. */
async function geraeteSpeichern(paketId: string, ids: string[]): Promise<void> {
  fehler.value = null;
  try {
    const neu = await api.patch<Paket>(`/pakete/${paketId}`, { geraet_ids: ids });
    const i = pakete.value.findIndex((p) => p.id === paketId);
    if (i >= 0) pakete.value[i] = neu;
    inhalt.value[paketId] = await api.get<PaketGeraet[]>(`/pakete/${paketId}/geraete`);
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Die Änderung konnte nicht gespeichert werden.";
  }
}

async function hinzufuegen(paketId: string, geraetId: string): Promise<void> {
  const jetzt = (inhalt.value[paketId] ?? []).map((g) => g.id);
  if (jetzt.includes(geraetId)) return;
  await geraeteSpeichern(paketId, [...jetzt, geraetId]);
  suchtext.value = "";
}

async function entfernen(paketId: string, geraetId: string): Promise<void> {
  const jetzt = (inhalt.value[paketId] ?? []).map((g) => g.id);
  await geraeteSpeichern(
    paketId,
    jetzt.filter((id) => id !== geraetId),
  );
}

async function loeschen(paket: Paket): Promise<void> {
  if (!confirm(`„${paket.name}“ löschen? Die Geräte bleiben unberührt.`)) return;
  try {
    await api.delete(`/pakete/${paket.id}`);
    pakete.value = pakete.value.filter((p) => p.id !== paket.id);
    offen.value = null;
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Das Paket konnte nicht gelöscht werden.";
  }
}

/**
 * Paket ausgeben: füllt die Sammelliste und führt zur Sammelbuchung.
 *
 * Ausgemusterte Geräte bleiben außen vor — sie ließen sich ohnehin nicht
 * buchen und würden die Liste nur mit einem Fehler blockieren.
 */
function ausgeben(paketId: string): void {
  bestand.sammlungLeeren();
  for (const g of inhalt.value[paketId] ?? []) {
    if (g.status !== "ausgemustert") bestand.sammle(g.id);
  }
  void router.push("/sammeln/ausgabe");
}

async function formularZeigen(): Promise<void> {
  neuOffen.value = true;
  await nextTick();
  nameEl.value?.focus();
}

onMounted(async () => {
  await bestand.laden();
  await laden();
});
</script>

<template>
  <div>
    <Kopf titel="Pakete" :unter="`${pakete.length} zusammengestellt`" />

    <div v-if="darfPflegen" class="anlage">
      <button v-if="!neuOffen" class="pt-btn pt-btn--breit" @click="formularZeigen">
        <Symbol name="plus" /> Neues Paket
      </button>
      <form v-else class="formular" @submit.prevent="anlegen">
        <label class="pt-label" for="paket-name">Name des Pakets</label>
        <input
          id="paket-name"
          ref="nameEl"
          v-model="neuName"
          class="pt-feld"
          maxlength="120"
          placeholder="z. B. Estrich komplett"
          autocomplete="off"
        />
        <div class="knopfzeile">
          <button type="button" class="pt-btn pt-btn--still" @click="neuOffen = false">
            Fertig
          </button>
          <button
            type="submit"
            class="pt-btn pt-btn--primaer"
            :disabled="speichert || !neuName.trim()"
          >
            Anlegen
          </button>
        </div>
      </form>
    </div>

    <p v-if="fehler" class="pt-meldung pt-meldung--fehler meldung">{{ fehler }}</p>
    <p v-if="laedt" class="pt-leer">Wird geladen …</p>
    <p v-else-if="!pakete.length" class="pt-leer">
      Noch keine Pakete. Ein Paket fasst Geräte zusammen, die immer gemeinsam
      hinausgehen.
    </p>

    <ul v-else class="pt-liste liste">
      <li v-for="p in pakete" :key="p.id">
        <button class="pt-zeile" :aria-expanded="offen === p.id" @click="umschalten(p.id)">
          <div class="pt-zeile__haupt">
            <div class="pt-zeile__titel">{{ p.name }}</div>
            <div class="pt-zeile__unter">{{ p.anzahl }} Gerät{{ p.anzahl === 1 ? "" : "e" }}</div>
          </div>
        </button>

        <div v-if="offen === p.id" class="aufklappen">
          <ul v-if="inhalt[p.id]?.length" class="pt-liste">
            <li v-for="g in inhalt[p.id]" :key="g.id" class="zeile">
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
              </div>
              <StatusChip :status="g.status" />
              <button
                v-if="darfPflegen"
                class="pt-btn pt-btn--still kleinknopf"
                @click="entfernen(p.id, g.id)"
              >
                Entfernen
              </button>
            </li>
          </ul>
          <p v-else class="pt-leer">Noch kein Gerät zugeordnet.</p>

          <div v-if="darfPflegen" class="feldgruppe">
            <label class="pt-label" :for="`suche-${p.id}`">Gerät hinzufügen</label>
            <input
              :id="`suche-${p.id}`"
              v-model="suchtext"
              class="pt-feld"
              placeholder="Bezeichnung oder Nummer …"
              autocomplete="off"
            />
            <ul v-if="treffer.length" class="pt-liste vorschlaege">
              <li v-for="g in treffer" :key="g.id">
                <button class="pt-zeile" @click="hinzufuegen(p.id, g.id)">
                  <div class="pt-zeile__haupt">
                    <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                    <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
                  </div>
                </button>
              </li>
            </ul>
          </div>

          <div class="knopfzeile knopfzeile--breit">
            <button
              v-if="darfPflegen"
              class="pt-btn pt-btn--still"
              @click="loeschen(p)"
            >
              Paket löschen
            </button>
            <button
              class="pt-btn pt-btn--primaer"
              :disabled="!inhalt[p.id]?.length"
              @click="ausgeben(p.id)"
            >
              Paket ausgeben
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.anlage {
  padding: var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.formular {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.meldung {
  margin: var(--space-3) var(--space-4);
}
.liste {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.aufklappen {
  background: var(--surface-subtle);
  border-top: 1px solid var(--hairline);
  padding: var(--space-2) var(--space-4) var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.zeile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) 0;
}
.feldgruppe {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.vorschlaege {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-top: var(--space-2);
}
.knopfzeile {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
.knopfzeile--breit {
  justify-content: space-between;
}
.kleinknopf {
  font-size: var(--fs-12);
  padding: var(--space-1) var(--space-2);
}
</style>
