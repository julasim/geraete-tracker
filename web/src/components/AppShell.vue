<script setup lang="ts">
/**
 * Der Rahmen — in zwei Haltungen.
 *
 * **Unter 1024 px:** eine Spalte, Navigation UNTEN. Auf der Baustelle wird
 * einhändig bedient, und der Daumen erreicht den oberen Bildschirmrand nicht.
 *
 * **Ab 1024 px:** Seitenleiste links, Inhalt rechts. Am Schreibtisch gibt es
 * keinen Daumen, dafür Platz in der Breite und mehr Ziele, als vier Reiter
 * fassen — Prüfungen, Pakete, Etiketten, Import, Stammdaten, Benutzer.
 *
 * **Nur ein Umbruchpunkt, keine Zwischenstufe.** Ein iPad quer bekommt die
 * Seitenleiste, ein iPad hoch die untere Leiste. Zwei Haltungen sind
 * begreifbar, drei nicht.
 *
 * Der Wechsel geschieht über eine Medienabfrage in CSS und dieselbe Abfrage
 * in JavaScript: Die untere Leiste soll im DOM gar nicht erst auftauchen,
 * wenn sie unsichtbar wäre — sonst führen Tastatur und Vorlesehilfe durch
 * eine doppelte Navigation.
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { api } from "@/api";
import { useBreite } from "@/composables/useBreite";
import { useAnmeldung } from "@/stores/anmeldung";
import type { FaelligePruefung } from "@/typen";
import SeitenLeiste from "./SeitenLeiste.vue";
import Symbol from "./Symbol.vue";

const route = useRoute();
const anmeldung = useAnmeldung();

const reiter = [
  { pfad: "/scan", symbol: "scan" as const, text: "Scannen" },
  { pfad: "/geraete", symbol: "liste" as const, text: "Geräte" },
  { pfad: "/orte", symbol: "ort" as const, text: "Orte" },
  { pfad: "/mehr", symbol: "mehr" as const, text: "Mehr" },
];

const istAktiv = (pfad: string) => route.path === pfad || route.path.startsWith(pfad + "/");
// Der Sucher soll den ganzen Schirm bekommen.
const ohneRahmen = computed(() => route.meta.ohneRahmen === true);

/*
 * Die Grenze steht an EINER Stelle: composables/useBreite.ts. Sie lag hier,
 * bis die sieben Computer-Ansichten dieselbe Frage stellten — sieben eigene
 * Beobachter auf derselben Medienabfrage wären sieben Gelegenheiten, den
 * Wert auseinanderlaufen zu lassen.
 */
const { breit } = useBreite();

/** Überfällige Prüfungen — der Zähler an der Seitenleiste. */
const faellig = ref(0);

onMounted(async () => {
  try {
    const liste = await api.get<FaelligePruefung[]>("/pruefungen/faellig");
    faellig.value = liste.filter((p) => p.ampel === "ueberfaellig").length;
  } catch {
    // Ohne Zahl bleibt der Zähler aus. Ein fehlender Hinweis ist besser als
    // eine erfundene Zahl.
  }
});
</script>

<template>
  <div class="shell" :class="{ 'shell--blank': ohneRahmen, 'shell--breit': breit }">
    <SeitenLeiste v-if="breit && !ohneRahmen && anmeldung.angemeldet" :faellig="faellig" />

    <main class="shell__inhalt">
      <div class="shell__breite">
        <slot />
      </div>
    </main>

    <nav v-if="!breit" class="leiste" aria-label="Hauptnavigation">
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

/* Ab 1024 px nebeneinander: Leiste links, Inhalt rechts. */
.shell--breit {
  flex-direction: row;
  height: 100dvh;
  overflow: hidden;
}

.shell__inhalt {
  flex: 1;
  /* Platz für die Leiste plus die Gestenzone am unteren Rand des iPhones. */
  padding-bottom: calc(var(--leiste-hoehe) + env(safe-area-inset-bottom) + var(--space-4));
}

/*
 * Im breiten Modus scrollt der INHALT, nicht die Seite: Sonst wanderte die
 * Seitenleiste beim Scrollen mit nach oben aus dem Bild.
 */
.shell--breit .shell__inhalt {
  padding-bottom: 0;
  overflow-y: auto;
  min-width: 0;
}

.shell--blank .shell__inhalt {
  padding-bottom: calc(var(--leiste-hoehe) + env(safe-area-inset-bottom));
}

.shell__breite {
  max-width: var(--container);
  margin: 0 auto;
}

/* Am Schreibtisch keine Mittenbegrenzung — die Tabelle nutzt die Breite. */
.shell--breit .shell__breite {
  max-width: none;
  margin: 0;
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
