<script setup lang="ts">
/**
 * Kanban-Ansicht: Geräte nach Status als Spalten, jede Karte zeigt
 * Inventarnummer, Titelbild und Bezeichnung.
 */
import { computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import { useBestand } from "@/stores/bestand";
import { STATUS_TEXT, type GeraetStatus, type Geraet } from "@/typen";
import TopLeiste from "@/components/TopLeiste.vue";

const bestand = useBestand();
const router = useRouter();

const SPALTEN: { status: GeraetStatus; titel: string }[] = [
  { status: "verfuegbar", titel: STATUS_TEXT.verfuegbar },
  { status: "ausgegeben", titel: STATUS_TEXT.ausgegeben },
  { status: "wartung", titel: STATUS_TEXT.wartung },
  { status: "defekt", titel: STATUS_TEXT.defekt },
  { status: "ausgemustert", titel: STATUS_TEXT.ausgemustert },
];

const spalten = computed(() =>
  SPALTEN.map((s) => ({
    ...s,
    geraete: bestand.geraete.filter((g) => g.status === s.status),
  })).filter((s) => s.geraete.length > 0),
);

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
  <TopLeiste titel="Board" :unter="`${bestand.geraete.length} Geräte`" />

  <div class="kanban">
    <div v-for="s in spalten" :key="s.status" class="kanban__spalte">
      <div class="kanban__kopf" :class="`kanban__kopf--${s.status}`">
        <span class="kanban__titel">{{ s.titel }}</span>
        <span class="kanban__anzahl">{{ s.geraete.length }}</span>
      </div>

      <div class="kanban__karten">
        <button
          v-for="g in s.geraete"
          :key="g.id"
          type="button"
          class="kanban__karte"
          @click="oeffnen(g)"
        >
          <div class="kanban__karte-kopf">
            <span class="kanban__nr pt-mono">{{ g.inventarnummer ?? "—" }}</span>
            <span class="pt-chip" :class="`pt-chip--${g.status}`">{{ STATUS_TEXT[g.status] }}</span>
          </div>

          <div class="kanban__bild-rahmen">
            <img
              v-if="g.titelbild_id"
              :src="`/api/dateien/${g.titelbild_id}`"
              :alt="g.bezeichnung"
              class="kanban__bild"
              loading="lazy"
            />
            <div v-else class="kanban__kein-bild">Kein Bild</div>
          </div>

          <div class="kanban__bezeichnung">{{ g.bezeichnung }}</div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kanban {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  overflow-x: auto;
  min-height: 0;
  flex: 1;
}

/* ── Spalte ─────────────────────────────────────────────── */
.kanban__spalte {
  flex: 1 1 0;
  min-width: 220px;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  background: var(--surface-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.kanban__kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-3) var(--space-4);
  border-bottom: 3px solid var(--border);
}
.kanban__kopf--verfuegbar { border-bottom-color: var(--success-bg); }
.kanban__kopf--ausgegeben { border-bottom-color: var(--warning-bg); }
.kanban__kopf--wartung { border-bottom-color: var(--accent); }
.kanban__kopf--defekt { border-bottom-color: var(--danger-bg); }
.kanban__kopf--ausgemustert { border-bottom-color: var(--fg-muted); }

.kanban__titel {
  font-size: var(--fs-14);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.kanban__anzahl {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Kartenliste ────────────────────────────────────────── */
.kanban__karten {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* ── Karte ──────────────────────────────────────────────── */
.kanban__karte {
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
.kanban__karte:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.kanban__karte:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.kanban__karte-kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
}
.kanban__nr {
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg-muted);
}

/* ── Bild ───────────────────────────────────────────────── */
.kanban__bild-rahmen {
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: var(--surface-muted);
}
.kanban__bild {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.kanban__kein-bild {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

/* ── Bezeichnung ────────────────────────────────────────── */
.kanban__bezeichnung {
  padding: var(--space-2) var(--space-3) var(--space-3);
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
  line-height: 1.3;
  text-align: left;
}

/* ── Tablet: Spalten scrollen horizontal ────────────────── */
@media (max-width: 1023px) {
  .kanban__spalte {
    flex: 0 0 260px;
    max-width: none;
  }
}

/* ── Mobil: Spalten untereinander, Karten als Grid ──────── */
@media (max-width: 767px) {
  .kanban {
    flex-direction: column;
    overflow-x: visible;
  }
  .kanban__spalte {
    flex: none;
    min-width: 0;
    max-width: none;
  }
  .kanban__karten {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    max-height: none;
  }
}
</style>
