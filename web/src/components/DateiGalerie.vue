<script setup lang="ts">
/**
 * Fotos und Dokumente eines Geräts.
 *
 * Zwei Aufnahmewege nebeneinander: Am Handy öffnet "Foto aufnehmen" direkt
 * die Kamera (capture-Attribut), "Datei wählen" den Dateiauswahl-Dialog.
 * Am Rechner führt beides zum selben Dialog — das schadet nicht und spart
 * eine Fallunterscheidung, die sich ohnehin nicht zuverlässig treffen lässt.
 */
import { computed, ref } from "vue";
import { ApiError } from "@/api";
import { groesse, useFoto } from "@/composables/useFoto";
import { useAnmeldung } from "@/stores/anmeldung";
import type { Datei } from "@/typen";
import Symbol from "./Symbol.vue";

const props = defineProps<{ geraetId: string; dateien: Datei[] }>();
const emit = defineEmits<{ geaendert: [] }>();

const anmeldung = useAnmeldung();
const foto = useFoto();

const kameraEl = ref<HTMLInputElement | null>(null);
const dateiEl = ref<HTMLInputElement | null>(null);
const laedtHoch = ref(false);
const fehler = ref<string | null>(null);
const grossAnsicht = ref<Datei | null>(null);

const bilder = computed(() => props.dateien.filter((d) => d.art === "foto"));
const dokumente = computed(() => props.dateien.filter((d) => d.art === "dokument"));

async function gewaehlt(ereignis: Event): Promise<void> {
  const eingabe = ereignis.target as HTMLInputElement;
  const dateien = [...(eingabe.files ?? [])];
  eingabe.value = ""; // dieselbe Datei soll erneut wählbar sein
  if (!dateien.length) return;

  laedtHoch.value = true;
  fehler.value = null;
  try {
    for (const roh of dateien) {
      const fertig = await foto.vorbereiten(roh);
      const formular = new FormData();
      formular.append("datei", fertig.datei);

      const antwort = await fetch(`/api/geraete/${props.geraetId}/dateien`, {
        method: "POST",
        body: formular,
        credentials: "same-origin",
      });
      if (!antwort.ok) {
        const koerper = await antwort.json().catch(() => ({}));
        throw new ApiError(antwort.status, koerper.error ?? "Hochladen fehlgeschlagen", koerper);
      }
    }
    emit("geaendert");
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Hochladen fehlgeschlagen";
  } finally {
    laedtHoch.value = false;
  }
}

async function alsTitelbild(datei: Datei): Promise<void> {
  await fetch(`/api/dateien/${datei.id}/titelbild`, {
    method: "POST",
    credentials: "same-origin",
  });
  emit("geaendert");
}

async function entfernen(datei: Datei): Promise<void> {
  if (!confirm(`"${datei.dateiname}" wirklich löschen?`)) return;
  await fetch(`/api/dateien/${datei.id}`, { method: "DELETE", credentials: "same-origin" });
  grossAnsicht.value = null;
  emit("geaendert");
}
</script>

<template>
  <section>
    <h2 class="pt-mikro abschnitt">Fotos und Dokumente</h2>

    <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

    <div v-if="bilder.length" class="raster">
      <button
        v-for="b in bilder"
        :key="b.id"
        class="kachel"
        :class="{ 'kachel--titel': b.ist_titelbild }"
        @click="grossAnsicht = b"
      >
        <img :src="`/api/dateien/${b.id}`" :alt="b.titel ?? b.dateiname" loading="lazy" />
        <span v-if="b.ist_titelbild" class="kachel__marke">Titelbild</span>
      </button>
    </div>

    <ul v-if="dokumente.length" class="pt-karte pt-liste dokumente">
      <li v-for="d in dokumente" :key="d.id">
        <a :href="`/api/dateien/${d.id}`" target="_blank" rel="noopener" class="pt-zeile">
          <div class="pt-zeile__haupt">
            <div class="pt-zeile__titel">{{ d.titel ?? d.dateiname }}</div>
            <div class="pt-zeile__unter">PDF · {{ groesse(d.groesse) }}</div>
          </div>
        </a>
      </li>
    </ul>

    <p v-if="!bilder.length && !dokumente.length" class="pt-leer leer">
      Noch keine Fotos. Ein Bild vom Typenschild hilft später beim Bestellen von Ersatzteilen.
    </p>

    <div v-if="anmeldung.darf('dateien.hochladen')" class="knoepfe">
      <!-- capture öffnet am Handy direkt die Kamera. Am Rechner wird das
           Attribut ignoriert und der normale Dialog erscheint. -->
      <input
        ref="kameraEl"
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        @change="gewaehlt"
      />
      <input
        ref="dateiEl"
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        @change="gewaehlt"
      />

      <button class="pt-btn" :disabled="laedtHoch" @click="kameraEl?.click()">
        <Symbol name="scan" :groesse="18" />
        Foto aufnehmen
      </button>
      <button class="pt-btn" :disabled="laedtHoch" @click="dateiEl?.click()">
        Datei wählen
      </button>
    </div>

    <p v-if="laedtHoch" class="pt-gedaempft lade">Wird hochgeladen …</p>

    <!-- Großansicht -->
    <div v-if="grossAnsicht" class="lupe" @click.self="grossAnsicht = null">
      <img :src="`/api/dateien/${grossAnsicht.id}`" :alt="grossAnsicht.dateiname" />
      <div class="lupe__leiste">
        <button class="pt-btn" @click="grossAnsicht = null">
          <Symbol name="schliessen" :groesse="18" />
          Schließen
        </button>
        <button
          v-if="anmeldung.darf('dateien.verwalten') && !grossAnsicht.ist_titelbild"
          class="pt-btn"
          @click="alsTitelbild(grossAnsicht)"
        >
          Als Titelbild
        </button>
        <button v-if="anmeldung.darf('dateien.verwalten')" class="pt-btn" @click="entfernen(grossAnsicht)">
          Löschen
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.abschnitt {
  margin-bottom: var(--space-2);
}

.raster {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.kachel {
  position: relative;
  aspect-ratio: 1;
  padding: 0;
  overflow: hidden;
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.kachel--titel {
  border-color: var(--fg);
  border-width: 2px;
}
.kachel img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.kachel__marke {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 2px;
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
  color: #fff;
  background: rgba(0, 0, 0, 0.65);
}

.dokumente {
  margin-bottom: var(--space-3);
}

.leer {
  padding: var(--space-6) var(--space-4);
  font-size: var(--fs-13);
}

.knoepfe {
  display: flex;
  gap: var(--space-2);
}
.knoepfe .pt-btn {
  flex: 1;
}

.lade {
  margin-top: var(--space-2);
  font-size: var(--fs-13);
}

.lupe {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4);
  padding: var(--space-4);
  background: rgba(0, 0, 0, 0.92);
}
.lupe img {
  max-width: 100%;
  max-height: 72dvh;
  object-fit: contain;
  border-radius: var(--radius-lg);
}
.lupe__leiste {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: center;
}
</style>
