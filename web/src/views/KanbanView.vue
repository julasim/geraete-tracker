<script setup lang="ts">
/**
 * Board-Ansicht: Alle Geräte als Karten-Raster mit Inventarnummer,
 * Titelbild, Bezeichnung und Status-Chip.
 */
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useBestand } from "@/stores/bestand";
import { STATUS_TEXT, type Geraet } from "@/typen";
import TopLeiste from "@/components/TopLeiste.vue";

const bestand = useBestand();
const router = useRouter();

const geraete = computed(() => bestand.geraete);

function oeffnen(g: Geraet): void {
  router.push(`/geraete/${g.id}`);
}

let intervall: ReturnType<typeof setInterval>;
onMounted(() => {
  bestand.laden();
  intervall = setInterval(() => bestand.laden(), 30_000);
});
onUnmounted(() => clearInterval(intervall));
</script>

<template>
  <TopLeiste titel="Board" :unter="`${geraete.length} Geräte`" />

  <div class="board">
    <button
      v-for="g in geraete"
      :key="g.id"
      type="button"
      class="board__karte"
      @click="oeffnen(g)"
    >
      <div class="board__karte-kopf">
        <span class="board__nr pt-mono">{{ g.inventarnummer ?? "—" }}</span>
        <span class="pt-chip" :class="`pt-chip--${g.status}`">{{ STATUS_TEXT[g.status] }}</span>
      </div>

      <div class="board__bild-rahmen">
        <img
          v-if="g.titelbild_id"
          :src="`/api/dateien/${g.titelbild_id}/thumb`"
          :alt="g.bezeichnung"
          class="board__bild"
          loading="lazy"
        />
        <div v-else class="board__kein-bild">Kein Bild</div>
      </div>

      <div class="board__bezeichnung">{{ g.bezeichnung }}</div>
    </button>
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-4);
  padding: var(--space-4);
  flex: 1;
  align-content: start;
}

/* ── Karte ──────────────────────────────────────────────── */
.board__karte {
  all: unset;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  overflow: hidden;
  transition: box-shadow var(--t-fast) var(--ease);
}
.board__karte:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.board__karte:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.board__karte-kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
}
.board__nr {
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg-muted);
}

/* ── Bild ───────────────────────────────────────────────── */
.board__bild-rahmen {
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--surface-muted);
}
.board__bild {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.board__kein-bild {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

/* ── Bezeichnung ────────────────────────────────────────── */
.board__bezeichnung {
  padding: var(--space-2) var(--space-3) var(--space-3);
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
  line-height: 1.3;
  text-align: left;
}

/* ── Mobil: engeres Raster ──────────────────────────────── */
@media (max-width: 767px) {
  .board {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: var(--space-3);
    padding: var(--space-3);
  }
}
</style>
