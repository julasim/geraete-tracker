<script setup lang="ts">
/**
 * Die Geräteliste als Karten — die Haltung des iPads.
 *
 * Am Schreibtisch steht an dieser Stelle die dichte Tabelle
 * (`GeraeteTabelle.vue`), quer am iPad diese Liste: Mit dem Finger trifft
 * niemand eine 48 px hohe Tabellenzeile mit einem 18 px großen Kästchen
 * darin. Beide Bauteile haben denselben Vertrag; `GeraeteView` tauscht sie
 * nur gegeneinander und muss sonst nichts wissen.
 *
 * **Alles steht in der Unterzeile**, was in der Tabelle eine eigene Spalte
 * hätte: Nummer · Ort · Person oder Regalplatz · Dauer. Leere Werte fallen
 * weg, statt als „—" Platz zu belegen — in der Tabelle ist der Strich nötig,
 * sonst verrutscht die Spalte; in einer fortlaufenden Zeile ist er nur Lärm.
 *
 * **Die Mehrfachauswahl gibt es auch hier**, sonst verlöre das iPad die
 * Sammelausgabe. Das Kästchen bleibt 18 px groß, sein Tippziel ist 44 px —
 * und es liegt NEBEN dem Zeilenknopf, nicht darin: Ein Tipp aufs Kästchen
 * darf nicht das Detail öffnen. Das über `@click.stop` zu regeln wäre eine
 * Verabredung, die beim nächsten Umbau still bricht; zwei Geschwister können
 * sich gar nicht erst ins Gehege kommen.
 *
 * Die Klassen heißen durchgängig `geraetekarten…`. Vue vergibt das
 * scoped-Attribut der ELTERNkomponente auch an das Wurzelelement des Kindes —
 * ein allgemeiner Name wie `karte` oder `zeile` würde von der Ansicht, in die
 * dieses Bauteil eingehängt wird, überschrieben. Genau so ist die Seitenleiste
 * schon einmal als 60-px-Streifen am unteren Rand gelandet.
 */
import { computed } from "vue";
import { useOffeneAusgaben } from "@/composables/useOffeneAusgaben";
import { dauer } from "@/format";
import type { Geraet } from "@/typen";
import StatusChip from "./StatusChip.vue";

const props = defineProps<{
  /** Die bereits gefilterten und sortierten Geräte. */
  geraete: Geraet[];
  /** Ids der ausgewählten Zeilen — kommt aus bestand.sammlung. */
  auswahl: string[];
  /** Darf überhaupt ausgewählt werden? (Recht buchungen.erfassen) */
  waehlbar?: boolean;
}>();

const emit = defineEmits<{
  /** Zeile angeklickt — Detail öffnen. */
  oeffnen: [id: string];
  /** Kästchen einer Zeile umgeschaltet. */
  umschalten: [id: string];
  /** Alle sichtbaren auswählen. */
  alle: [ids: string[]];
  /** Auswahl aufheben. */
  keine: [];
}>();

/** Wie lange die Geräte schon draußen sind — dieselbe Quelle wie die Tabelle. */
const { draussen } = useOffeneAusgaben();

/** Zwischen zwei Angaben steht ein Mittelpunkt, nirgends sonst. */
const TRENNER = " · ";

const zeilen = computed(() =>
  props.geraete.map((g) => {
    /*
     * Person, wenn das Gerät draußen ist — sonst der Regalplatz. Beides
     * zugleich gibt es nicht: Was jemand mitgenommen hat, liegt in keinem
     * Regal.
     */
    const angaben = [g.standort, g.nutzer ?? g.lagerplatz].filter((w): w is string => Boolean(w));
    const offen = draussen.value.get(g.id);
    return {
      geraet: g,
      /*
       * Der Trenner steckt im Text, nicht als eigener Knoten in der Vorlage:
       * Zwischen zwei Elementen wirft Vue den Zeilenumbruch weg, neben einer
       * Auswertung `{{ … }}` aber nicht — dort würde aus „10004 · Bauhof"
       * je nach Umbruch „10004  · Bauhof".
       */
      rest: angaben.length ? (g.inventarnummer ? TRENNER : "") + angaben.join(TRENNER) : "",
      seit: offen ? (g.inventarnummer || angaben.length ? TRENNER : "") + dauer(offen.tage) : "",
      spaet: offen?.ueberfaellig ?? false,
    };
  }),
);

/**
 * Gezählt wird, was auch zu sehen ist. Die Sammlung kann Geräte enthalten,
 * die der Filter gerade ausblendet — „alle angehakt" darf sich nicht auf
 * Zeilen beziehen, die niemand vor sich hat.
 */
const sichtbarGewaehlt = computed(
  () => props.geraete.filter((g) => props.auswahl.includes(g.id)).length,
);
const alleGewaehlt = computed(
  () => props.geraete.length > 0 && sichtbarGewaehlt.value === props.geraete.length,
);
const teilweise = computed(() => sichtbarGewaehlt.value > 0 && !alleGewaehlt.value);

function alleUmschalten(): void {
  if (alleGewaehlt.value) {
    emit("keine");
    return;
  }
  emit(
    "alle",
    props.geraete.map((g) => g.id),
  );
}
</script>

<template>
  <div class="pt-karte geraetekarten">
    <div v-if="waehlbar" class="geraetekarten__kopf">
      <!--
        `@click.prevent`: Das Kästchen wird von `auswahl` regiert, nicht von
        sich selbst. Ohne prevent schaltete der Browser es sofort um — und
        wenn der Aufrufer die Änderung verwirft, stünde ein Haken da, den
        niemand gesetzt hat.
      -->
      <label class="geraetekarten__ziel">
        <input
          type="checkbox"
          class="geraetekarten__box"
          :checked="alleGewaehlt"
          :indeterminate="teilweise"
          :aria-label="alleGewaehlt ? 'Auswahl aufheben' : 'Alle sichtbaren auswählen'"
          @click.prevent="alleUmschalten"
        />
      </label>
      <span class="geraetekarten__stand">
        {{ auswahl.length ? `${auswahl.length} ausgewählt` : `${geraete.length} sichtbar` }}
      </span>
    </div>

    <p v-if="!geraete.length" class="pt-leer">Kein Gerät passt zur Suche.</p>

    <ul v-else class="pt-liste">
      <li v-for="z in zeilen" :key="z.geraet.id">
        <div
          class="geraetekarten__reihe"
          :class="{
            'geraetekarten__reihe--waehlbar': waehlbar,
            'geraetekarten__reihe--gewaehlt': auswahl.includes(z.geraet.id),
          }"
        >
          <label v-if="waehlbar" class="geraetekarten__ziel">
            <input
              type="checkbox"
              class="geraetekarten__box"
              :checked="auswahl.includes(z.geraet.id)"
              :aria-label="`${z.geraet.bezeichnung} auswählen`"
              @click.prevent="emit('umschalten', z.geraet.id)"
            />
          </label>

          <button
            type="button"
            class="pt-zeile geraetekarten__zeile"
            @click="emit('oeffnen', z.geraet.id)"
          >
            <div class="pt-zeile__haupt">
              <div class="pt-zeile__titel">{{ z.geraet.bezeichnung }}</div>
              <div class="pt-zeile__unter">
                <span v-if="z.geraet.inventarnummer" class="pt-mono">{{ z.geraet.inventarnummer }}</span>
                <span v-if="z.rest">{{ z.rest }}</span>
                <span v-if="z.seit" :class="{ 'geraetekarten__spaet': z.spaet }">{{ z.seit }}</span>
              </div>
            </div>
            <StatusChip :status="z.geraet.status" />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.geraetekarten {
  background: var(--surface);
}

/* ── Kopf: Alle/Keine und der Stand der Auswahl ──────────── */
.geraetekarten__kopf {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: 0 var(--space-2);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
}
.geraetekarten__stand {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

/* ── Zeile ───────────────────────────────────────────────── */
.geraetekarten__reihe {
  display: flex;
  align-items: center;
}
/* Ausgewählt ist eine Fläche, keine Farbe — der Akzent ist Ink. */
.geraetekarten__reihe--gewaehlt,
.geraetekarten__reihe--gewaehlt .geraetekarten__zeile:hover {
  background: var(--surface-muted);
}

.geraetekarten__zeile {
  /*
   * 14px steht so im Entwurf und ist der einzige Wert außerhalb des
   * 4pt-Rasters: Mit 12px stehen die beiden Textzeilen zu eng aufeinander,
   * mit 16px passen auf die 768px Höhe des iPads zwei Zeilen weniger.
   */
  padding: 14px var(--space-5);
}
/* Links sitzt schon das Kästchen — der Text braucht dort keinen zweiten Rand. */
.geraetekarten__reihe--waehlbar .geraetekarten__zeile {
  padding-left: var(--space-2);
}

/* Überzogene Rückgabe: dieselbe Farbe wie die Spalte „Seit" der Tabelle. */
.geraetekarten__spaet {
  color: var(--danger-fg);
  font-weight: var(--fw-medium);
}

/* ── Kästchen: 18px groß, 44px zu treffen ────────────────── */
.geraetekarten__ziel {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  cursor: pointer;
}

.geraetekarten__box {
  appearance: none;
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  margin: 0;
  flex: none;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}
.geraetekarten__box:checked,
.geraetekarten__box:indeterminate {
  background: var(--accent);
  border-color: var(--accent);
}
/*
 * Der Haken als Pseudoelement statt als Symbol im Template: Ein zweites
 * Element im Kästchen finge die Klicks ab, und `pointer-events: none` daran
 * wäre wieder eine Verabredung, die man beim Umbauen übersieht.
 */
.geraetekarten__box:checked::after {
  content: "";
  display: block;
  width: 5px;
  height: 9px;
  margin: 1px auto 0;
  border: solid var(--accent-fg);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}
/* Teilauswahl: ein Strich, kein Haken — „einige" ist nicht „alle". */
.geraetekarten__box:indeterminate::after {
  content: "";
  display: block;
  width: 8px;
  margin: 6px auto;
  border-top: 2px solid var(--accent-fg);
}

/*
 * Unter 1024 px greift die mobile Haltung, und dort gilt die Projektvorgabe
 * von 48 px: Daumen statt Zeigefinger, teils mit Arbeitshandschuhen. Die
 * 44 px des Entwurfs gelten für das iPad, nicht für die Baustelle.
 */
@media (max-width: 1023px) {
  .geraetekarten__ziel {
    width: 48px;
    height: 48px;
  }
  .geraetekarten__kopf {
    min-height: 48px;
  }
}
</style>
