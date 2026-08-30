<script setup lang="ts">
/**
 * Der Rahmen: Kopfzeile, Inhalt, untere Leiste.
 *
 * Anders als PATIO, das eine 3-Spalten-Bürooberfläche hat: Hier eine Spalte
 * und die Navigation UNTEN. Auf der Baustelle wird einhändig bedient, und
 * der Daumen erreicht den oberen Bildschirmrand nicht.
 */
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Symbol from "./Symbol.vue";

const route = useRoute();

const reiter = [
  { pfad: "/scan", symbol: "scan" as const, text: "Scannen" },
  { pfad: "/geraete", symbol: "liste" as const, text: "Geräte" },
  { pfad: "/orte", symbol: "ort" as const, text: "Orte" },
  { pfad: "/mehr", symbol: "mehr" as const, text: "Mehr" },
];

const istAktiv = (pfad: string) => route.path === pfad || route.path.startsWith(pfad + "/");
// Der Sucher soll den ganzen Schirm bekommen.
const ohneRahmen = computed(() => route.meta.ohneRahmen === true);
</script>

<template>
  <div class="shell" :class="{ 'shell--blank': ohneRahmen }">
    <main class="shell__inhalt">
      <div class="shell__breite">
        <slot />
      </div>
    </main>

    <nav class="leiste" aria-label="Hauptnavigation">
      <RouterLink
        v-for="r in reiter"
        :key="r.pfad"
        :to="r.pfad"
        class="leiste__reiter"
        :class="{ 'leiste__reiter--aktiv': istAktiv(r.pfad) }"
        :aria-current="istAktiv(r.pfad) ? 'page' : undefined"
      >
        <Symbol :name="r.symbol" :groesse="22" />
        <span>{{ r.text }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--surface-subtle);
}

.shell__inhalt {
  flex: 1;
  /* Platz für die Leiste plus die Gestenzone am unteren Rand des iPhones. */
  padding-bottom: calc(var(--leiste-hoehe) + env(safe-area-inset-bottom) + var(--space-4));
}

.shell--blank .shell__inhalt {
  padding-bottom: calc(var(--leiste-hoehe) + env(safe-area-inset-bottom));
}

.shell__breite {
  max-width: var(--container);
  margin: 0 auto;
}

.leiste {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: calc(var(--leiste-hoehe) + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--surface);
  border-top: 1px solid var(--border);
}

.leiste__reiter {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: var(--fs-11);
  font-weight: var(--fw-medium);
  /*
   * --fg-muted (#52525b) statt --fg-subtle (#a1a1aa): Letzteres ergibt auf
   * hellem Grund 2,6:1 und ist bei Sonnenlicht auf der Baustelle kaum zu
   * lesen — ausgerechnet an der Hauptnavigation. Mit --fg-muted sind es
   * 7,5:1, und der aktive Reiter hebt sich weiterhin klar ab, weil er
   * volles Ink trägt.
   */
  color: var(--fg-muted);
  transition: color var(--t-fast) var(--ease);
}

/* Der aktive Reiter trägt Ink — kein Farbakzent, wie im ganzen System. */
.leiste__reiter--aktiv {
  color: var(--fg);
}

@media (min-width: 720px) {
  .shell__breite {
    padding: 0 var(--space-4);
  }
}
</style>
