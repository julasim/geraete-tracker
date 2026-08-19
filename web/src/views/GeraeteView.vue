<script setup lang="ts">
/**
 * Die Geräteliste. Sucht und filtert im Browser — der ganze Bestand ist
 * bereits geladen, ein Serveraufruf je Tastendruck wäre auf der Baustelle
 * spürbar langsamer.
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useBestand } from "@/stores/bestand";
import type { GeraetStatus } from "@/typen";
import { useAnmeldung } from "@/stores/anmeldung";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";

const bestand = useBestand();
const router = useRouter();
const anmeldung = useAnmeldung();

const suchtext = ref("");
const filter = ref<GeraetStatus | "alle">("alle");

const FILTER: { wert: GeraetStatus | "alle"; text: string }[] = [
  { wert: "alle", text: "Alle" },
  { wert: "verfuegbar", text: "Verfügbar" },
  { wert: "ausgegeben", text: "Ausgegeben" },
  { wert: "defekt", text: "Defekt" },
];

const gefiltert = computed(() => {
  const treffer = bestand.suche(suchtext.value);
  return filter.value === "alle" ? treffer : treffer.filter((g) => g.status === filter.value);
});

onMounted(() => void bestand.laden());
</script>

<template>
  <div>
    <Kopf titel="Geräte" :unter="`${bestand.geraete.length} im Bestand`">
      <template #rechts>
        <button
          v-if="anmeldung.darf('geraete.pflegen')"
          class="pt-btn neu"
          aria-label="Gerät anlegen"
          @click="router.push('/geraete/neu')"
        >
          Neu
        </button>
      </template>
    </Kopf>

    <div class="werkzeuge">
      <div class="suchfeld">
        <Symbol name="suche" :groesse="18" />
        <input
          v-model="suchtext"
          class="pt-feld suchfeld__eingabe"
          type="search"
          placeholder="Bezeichnung, Nummer, Ort …"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>

      <div class="filter" role="group" aria-label="Filter">
        <button
          v-for="f in FILTER"
          :key="f.wert"
          class="filter__knopf"
          :class="{ 'filter__knopf--aktiv': filter === f.wert }"
          :aria-pressed="filter === f.wert"
          @click="filter = f.wert"
        >
          {{ f.text }}
        </button>
      </div>
    </div>

    <p v-if="bestand.laedt && !bestand.geraete.length" class="pt-leer">Wird geladen …</p>

    <p v-else-if="!gefiltert.length" class="pt-leer">
      <template v-if="bestand.geraete.length === 0">
        Noch keine Geräte erfasst.<br />
        <button
          v-if="anmeldung.darf('geraete.pflegen')"
          class="pt-btn pt-btn--primaer erstesgeraet"
          @click="router.push('/geraete/neu')"
        >
          Erstes Gerät anlegen
        </button>
      </template>
      <template v-else>Kein Gerät passt zur Suche.</template>
    </p>

    <ul v-else class="pt-liste liste">
      <li v-for="g in gefiltert" :key="g.id">
        <button class="pt-zeile" @click="router.push(`/geraete/${g.id}`)">
          <div class="pt-zeile__haupt">
            <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
            <div class="pt-zeile__unter">
              <span class="pt-mono">{{ g.inventarnummer }}</span>
              <template v-if="g.standort"> · {{ g.standort }}</template>
              <template v-if="g.nutzer"> · {{ g.nutzer }}</template>
            </div>
          </div>
          <StatusChip :status="g.status" />
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.werkzeuge {
  position: sticky;
  top: var(--kopf-hoehe);
  z-index: 5;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
}

.suchfeld {
  position: relative;
  display: flex;
  align-items: center;
}
.suchfeld svg {
  position: absolute;
  left: var(--space-3);
  color: var(--fg-subtle);
  pointer-events: none;
}
.suchfeld__eingabe {
  padding-left: calc(var(--space-3) * 2 + 18px);
}

.filter {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
  overflow-x: auto;
  scrollbar-width: none;
}
.filter::-webkit-scrollbar {
  display: none;
}

.filter__knopf {
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  color: var(--fg-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  cursor: pointer;
}
/* Aktiv = Ink, kein Farbakzent. */
.filter__knopf--aktiv {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: var(--accent);
}

.neu {
  min-height: 40px;
  padding: 0 var(--space-3);
  font-size: var(--fs-13);
}

.erstesgeraet {
  margin-top: var(--space-4);
}

.liste {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
</style>
