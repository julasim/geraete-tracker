<script setup lang="ts">
/**
 * Was ist fällig.
 *
 * Die Frage, die einmal im Monat gestellt wird — und die die Anwendung bis
 * jetzt nicht beantwortet hat: Fällige Prüfungen sah man nur, wenn man das
 * einzelne Gerät öffnete. Bei 200 Maschinen ist das keine Antwort.
 *
 * Der Server liefert die Liste fertig sortiert und ohne die Geräte, bei
 * denen noch Zeit ist (`/pruefungen/faellig`). Hier wird sie nur noch nach
 * Dringlichkeit gruppiert: Was überfällig ist, steht oben und bleibt dort,
 * bis jemand es erledigt.
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api, ApiError } from "@/api";
import type { Ampel, FaelligePruefung } from "@/typen";
import { ampelKlasse, frist } from "@/format";
import Kopf from "@/components/Kopf.vue";

const liste = ref<FaelligePruefung[]>([]);
const laedt = ref(true);
const fehler = ref<string | null>(null);

/** Die drei Stufen, die der Server liefert — "ok" ist dort schon heraus. */
const STUFEN: { ampel: Ampel; titel: string; erklaerung: string }[] = [
  {
    ampel: "ueberfaellig",
    titel: "Überfällig",
    erklaerung: "Die Frist ist verstrichen. Das Gerät darf so nicht mehr eingesetzt werden.",
  },
  {
    ampel: "faellig",
    titel: "Fällig",
    erklaerung: "Innerhalb der nächsten zwei Wochen.",
  },
  {
    ampel: "bald",
    titel: "Bald",
    erklaerung: "In den nächsten zwei Monaten — Zeit, einen Termin zu machen.",
  },
];

const nachStufe = computed(() =>
  STUFEN.map((s) => ({ ...s, eintraege: liste.value.filter((p) => p.ampel === s.ampel) })).filter(
    (s) => s.eintraege.length > 0,
  ),
);

const anzahlUeberfaellig = computed(
  () => liste.value.filter((p) => p.ampel === "ueberfaellig").length,
);

function datum(iso: string): string {
  return new Date(iso).toLocaleDateString("de-AT");
}



async function laden(): Promise<void> {
  laedt.value = true;
  try {
    liste.value = await api.get<FaelligePruefung[]>("/pruefungen/faellig");
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht geladen werden";
  } finally {
    laedt.value = false;
  }
}

onMounted(laden);
</script>

<template>
  <div>
    <Kopf
      titel="Prüfungen"
      :unter="liste.length ? `${liste.length} anstehend` : ''"
    />

    <div class="inhalt">
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>
      <p v-else-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <template v-else-if="!liste.length">
        <p class="pt-leer">
          Nichts steht an.<br />
          <span class="pt-gedaempft">
            Geprüft wird gegen die Prüfarten, die am Gerät hinterlegt sind — steht dort
            nichts, taucht das Gerät hier auch nicht auf.
          </span>
        </p>
      </template>

      <template v-else>
        <div v-if="anzahlUeberfaellig" class="pt-meldung pt-meldung--fehler kopfmeldung">
          <strong>{{ anzahlUeberfaellig }}</strong>
          {{ anzahlUeberfaellig === 1 ? "Prüfung ist überfällig" : "Prüfungen sind überfällig" }}.
        </div>

        <section v-for="stufe in nachStufe" :key="stufe.ampel">
          <h2 class="pt-mikro abschnitt">{{ stufe.titel }} ({{ stufe.eintraege.length }})</h2>
          <p class="pt-gedaempft erklaerung">{{ stufe.erklaerung }}</p>

          <ul class="pt-liste liste">
            <li v-for="p in stufe.eintraege" :key="`${p.geraet_id}-${p.pruefart}`">
              <RouterLink :to="`/geraete/${p.geraet_id}`" class="pt-zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ p.bezeichnung }}</div>
                  <div class="pt-zeile__unter">
                    <span class="pt-mono">{{ p.inventarnummer ?? "ohne Nummer" }}</span>
                    · {{ p.pruefart }} · {{ datum(p.naechste_faellig) }}
                  </div>
                </div>
                <span class="pt-chip" :class="ampelKlasse(p.ampel)">
                  {{ frist(p.tage_bis_faellig) }}
                </span>
              </RouterLink>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.inhalt {
  padding-bottom: var(--space-6);
}

.kopfmeldung {
  margin: var(--space-4);
}

.abschnitt {
  padding: var(--space-4) var(--space-4) 0;
}

.erklaerung {
  padding: 0 var(--space-4) var(--space-2);
  font-size: var(--fs-13);
}

.liste {
  background: var(--surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
</style>
