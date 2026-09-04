<script setup lang="ts">
/**
 * Die Suche als Knopf, der das Feld einblendet.
 *
 * Am iPad quer teilen sich Titel, Suche und „Gerät anlegen" eine 1024 px
 * breite Kopfzeile. Ein dauerhaft offenes 320-px-Feld nähme dort den Platz,
 * den die Aktion braucht — und gesucht wird nicht bei jedem Aufruf, während
 * der Titel immer gebraucht wird.
 *
 * ## Schnittstelle
 *
 * ```vue
 * <SuchKnopf v-model="suchtext" platzhalter="Bezeichnung, Nummer, Ort …" />
 * ```
 *
 * `v-model` ist Pflicht: Gesucht wird im Browser über den geladenen Bestand
 * (`bestand.suche()`), der Text gehört also der Ansicht, nicht diesem Knopf.
 * `platzhalter` ist freiwillig.
 *
 * ## Drei Regeln, die zusammengehören
 *
 * 1. **Escape schließt und leert nicht.** Wer sucht und danebengreift, will
 *    seine Eingabe nicht verlieren.
 * 2. **Ist etwas eingetippt, bleibt das Feld offen.** Es klappt nur zu, wenn
 *    es leer verlassen wird.
 * 3. **Ist es mit Text zugeklappt** — der einzige Weg dahin ist Escape —,
 *    **trägt der Knopf den Suchtext.** Sonst stünde eine gefilterte Liste da,
 *    ohne dass irgendwo zu sehen wäre, wonach gefiltert wird; und das ist der
 *    Zustand, in dem jemand meldet, es fehlten Geräte.
 *
 * Das Feld ist bewusst `type="text"` und nicht `type="search"`: Chrome und
 * Safari leeren ein Suchfeld bei Escape von sich aus — genau das, was Regel 1
 * verbietet. Mit `type="text"` stellt sich die Frage nicht.
 */
import { nextTick, ref } from "vue";
import Symbol from "./Symbol.vue";

const text = defineModel<string>({ required: true });

defineProps<{ platzhalter?: string }>();

const eingabeEl = ref<HTMLInputElement | null>(null);
const knopfEl = ref<HTMLElement | null>(null);

/** Mit Text im Feld ist die Suche der Zustand, in dem die Ansicht steht. */
const offen = ref(Boolean(text.value));

async function oeffnen(): Promise<void> {
  offen.value = true;
  await nextTick();
  eingabeEl.value?.focus();
}

async function schliessen(): Promise<void> {
  offen.value = false;
  // Ohne das läge der Fokus nach Escape auf dem Dokument, und die nächste
  // Tabulatortaste finge wieder ganz oben an.
  await nextTick();
  knopfEl.value?.focus();
}

function beiVerlassen(): void {
  if (!text.value.trim()) offen.value = false;
}
</script>

<template>
  <div class="suchknopf">
    <button
      v-if="!offen"
      ref="knopfEl"
      type="button"
      class="pt-btn suchknopf__knopf"
      :class="{ 'suchknopf__knopf--aktiv': Boolean(text) }"
      :aria-label="text ? `Suche ändern: ${text}` : 'Suchen'"
      @click="oeffnen"
    >
      <Symbol name="suche" :groesse="16" />
      <span class="suchknopf__wort">{{ text || "Suchen" }}</span>
    </button>

    <div v-else class="suchknopf__feld">
      <Symbol name="suche" :groesse="16" />
      <input
        ref="eingabeEl"
        v-model="text"
        class="pt-feld suchknopf__eingabe"
        type="text"
        :placeholder="platzhalter ?? 'Bezeichnung, Nummer, Ort …'"
        aria-label="Suchen"
        autocapitalize="off"
        autocomplete="off"
        spellcheck="false"
        @keydown.escape.prevent="schliessen"
        @blur="beiVerlassen"
      />
    </div>
  </div>
</template>

<style scoped>
.suchknopf {
  display: flex;
  align-items: center;
  min-width: 0;
}

/*
 * 44 px: das Tippziel am iPad. Steht dieser Knopf in der Kopfzeile, setzt
 * `TopLeiste` am Schreibtisch 36 px durch (`.topleiste__rechts .pt-btn`) und
 * am iPad wieder 44 — das ist gewollt und deckt sich mit dem Entwurf.
 */
.suchknopf__knopf {
  min-height: 44px;
  max-width: 240px;
  padding: 0 var(--space-3);
  font-size: var(--fs-13);
}
/* Zugeklappt mit Text: Die Suche läuft, also sieht der Knopf auch so aus. */
.suchknopf__knopf--aktiv {
  border-color: var(--border-strong);
  color: var(--fg);
}
.suchknopf__wort {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.suchknopf__feld {
  position: relative;
  display: flex;
  align-items: center;
}
/*
 * Kein `:deep` nötig: Das `<svg>` ist das Wurzelelement von `Symbol.vue` und
 * trägt deshalb das scoped-Attribut dieser Komponente mit.
 */
.suchknopf__feld svg {
  position: absolute;
  left: var(--space-3);
  color: var(--fg-subtle);
  pointer-events: none;
}
.suchknopf__eingabe {
  /* 44 px hoch, aber 16 px Schrift — darunter zoomt iOS beim Fokussieren. */
  min-height: 44px;
  width: 260px;
  max-width: 100%;
  /* Links Platz für die Lupe: Rand + Symbolbreite + Abstand. */
  padding: 0 var(--space-3) 0 calc(var(--space-3) * 2 + 16px);
  font-size: var(--fs-16);
}
</style>
