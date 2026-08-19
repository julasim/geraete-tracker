<script setup lang="ts">
/** Orte und ihr Bestand — beantwortet die Frage, was wo steht. */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "@/api";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Standort } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";

const bestand = useBestand();
const offen = ref<string | null>(null);
const inhalt = ref<Record<string, Geraet[]>>({});
const laedtOrt = ref<string | null>(null);

const orte = computed(() =>
  [...bestand.aktiveStandorte].sort((a, b) => {
    // Lager zuerst, dann Werkstatt, dann Baustellen — so sucht man auch im Kopf.
    const rang = (s: Standort) => (s.typ === "lager" ? 0 : s.typ === "werkstatt" ? 1 : 2);
    return rang(a) - rang(b) || a.name.localeCompare(b.name, "de");
  }),
);

const anzahlAmOrt = (id: string) =>
  bestand.geraete.filter((g) => g.aktueller_standort_id === id).length;

async function umschalten(id: string): Promise<void> {
  if (offen.value === id) {
    offen.value = null;
    return;
  }
  offen.value = id;
  if (inhalt.value[id]) return;

  laedtOrt.value = id;
  try {
    const antwort = await api.get<{ geraete: Geraet[] }>(`/standorte/${id}/bestand`);
    inhalt.value[id] = antwort.geraete;
  } finally {
    laedtOrt.value = null;
  }
}

const TYP_TEXT: Record<string, string> = {
  lager: "Lager",
  baustelle: "Baustelle",
  werkstatt: "Werkstatt",
  extern: "Extern",
};

onMounted(() => void bestand.laden());
</script>

<template>
  <div>
    <Kopf titel="Orte" :unter="`${orte.length} aktiv`" />

    <p v-if="!orte.length" class="pt-leer">Noch keine Orte erfasst.</p>

    <ul v-else class="pt-liste liste">
      <li v-for="o in orte" :key="o.id">
        <button class="pt-zeile" :aria-expanded="offen === o.id" @click="umschalten(o.id)">
          <div class="pt-zeile__haupt">
            <div class="pt-zeile__titel">{{ o.name }}</div>
            <div class="pt-zeile__unter">
              {{ TYP_TEXT[o.typ] }}<template v-if="o.adresse"> · {{ o.adresse }}</template>
            </div>
          </div>
          <span class="pt-chip pt-chip--neutral">{{ anzahlAmOrt(o.id) }}</span>
        </button>

        <div v-if="offen === o.id" class="aufklappen">
          <p v-if="laedtOrt === o.id" class="pt-leer">Wird geladen …</p>
          <p v-else-if="!inhalt[o.id]?.length" class="pt-leer">Hier steht derzeit nichts.</p>
          <ul v-else class="pt-liste">
            <li v-for="g in inhalt[o.id]" :key="g.id">
              <RouterLink :to="`/geraete/${g.id}`" class="pt-zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">
                    {{ g.inventarnummer
                    }}<template v-if="g.lagerplatz"> · {{ g.lagerplatz }}</template>
                  </div>
                </div>
                <StatusChip :status="g.status" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.liste {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.aufklappen {
  background: var(--surface-subtle);
  border-top: 1px solid var(--hairline);
  padding-left: var(--space-4);
}
</style>
