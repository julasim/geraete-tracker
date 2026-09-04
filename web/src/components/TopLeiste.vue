<script setup lang="ts">
/**
 * Die Kopfzeile der Computer-Oberfläche.
 *
 * Das Gegenstück zu `Kopf.vue`, das am Handy dieselbe Aufgabe erfüllt. Zwei
 * Bauteile statt einem mit Weiche, weil sich die beiden in fast jedem Maß
 * unterscheiden: 56 px statt 52 px, 24 px Innenabstand statt 16, Titel in
 * 20 px statt 18, und der Zurück-Knopf ist hier ein 32 px kleines Zeichen
 * statt eines 48 px großen Tippziels.
 *
 * **Die Höhe ist konstant 56 px** und stimmt damit mit dem Kopf der
 * Seitenleiste überein — sonst läge die Trennlinie links und rechts auf
 * verschiedener Höhe, was man sofort sieht.
 *
 * Am iPad wachsen die Knöpfe auf 44 px: Die 36 px vom Schreibtisch sind mit
 * dem Finger zu klein. Das ist die einzige Stelle, an der diese Komponente
 * die Abtönung `tablet` kennt — jede Ansicht müsste sie sonst selbst
 * nachbauen.
 */
import { useRouter } from "vue-router";
import { useBreite } from "@/composables/useBreite";
import Symbol from "./Symbol.vue";

defineProps<{
  titel: string;
  /** Zweite Zeile unter dem Titel, etwa „204 im Bestand“. */
  unter?: string;
  /** Zeigt den Zurück-Winkel links vom Titel. */
  zurueck?: boolean;
}>();

const router = useRouter();
const { tablet } = useBreite();
</script>

<template>
  <header class="topleiste" :class="{ 'topleiste--tablet': tablet }">
    <button
      v-if="zurueck"
      class="topleiste__zurueck"
      aria-label="Zurück"
      @click="router.back()"
    >
      <Symbol name="zurueck" :groesse="20" />
    </button>

    <div class="topleiste__marke">
      <h1 class="topleiste__titel">{{ titel }}</h1>
      <p v-if="unter" class="topleiste__unter">{{ unter }}</p>
    </div>

    <!-- Nummer, Status-Chip: alles, was unmittelbar zum Titel gehört. -->
    <slot name="nebenTitel" />

    <!-- Suchfeld und Ähnliches. Nimmt den freien Platz in der Mitte. -->
    <div class="topleiste__mitte"><slot name="mitte" /></div>

    <div class="topleiste__rechts"><slot name="rechts" /></div>
  </header>
</template>

<style scoped>
.topleiste {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: var(--topleiste-hoehe);
  flex: none;
  padding: 0 var(--space-6);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.topleiste__zurueck {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  margin-left: calc(var(--space-2) * -1);
  border-radius: var(--radius-md);
  color: var(--fg-body);
  cursor: pointer;
  transition: background var(--t-fast) var(--ease);
}
.topleiste__zurueck:hover {
  background: var(--surface-muted);
}

.topleiste__marke {
  min-width: 0;
}
.topleiste__titel {
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topleiste__unter {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * Die Mitte trägt den freien Platz. Sie steht auch dann da, wenn der Schlitz
 * leer ist — so sitzen die Aktionen rechts immer am rechten Rand, statt bei
 * jeder Ansicht woanders zu kleben.
 */
.topleiste__mitte {
  flex: 1;
  display: flex;
  align-items: center;
  min-width: 0;
}

.topleiste__rechts {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

/* Aktionen in der Kopfzeile sind kleiner als im Inhalt: 36 px statt 40. */
.topleiste__rechts :deep(.pt-btn) {
  min-height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--fs-13);
}

/* Mit dem Finger sind 36 px zu klein — am iPad zurück auf 44. */
.topleiste--tablet .topleiste__rechts :deep(.pt-btn) {
  min-height: 44px;
}

/*
 * Der Zurück-Winkel war davon zuerst ausgenommen — dabei steht er auf jeder
 * Detailseite und ist dort der einzige Rückweg: Die Seitenleiste führt nur
 * auf die Listen. Der negative Rand wächst mit, sonst rutscht das Zeichen
 * um 12 px nach rechts und die Kopfzeile fluchtet nicht mehr.
 */
.topleiste--tablet .topleiste__zurueck {
  width: 44px;
  height: 44px;
  margin-left: calc(var(--space-3) * -1);
}
</style>
