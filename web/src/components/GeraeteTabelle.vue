<script setup lang="ts">
/**
 * Der Bestand als dichte Tabelle — die Computer-Haltung der Geräteliste.
 *
 * Am Handy steht dieselbe Menge als Kartenliste, am iPad als `GeraeteKarten`.
 * Alle drei zeigen dieselben Datensätze; hier ist nur die Dichte eine andere,
 * weil am Schreibtisch verglichen und in Mengen gearbeitet wird statt
 * einhändig getippt.
 *
 * **Die Auswahl gehört dem Store, nicht dieser Tabelle.** Sie kommt als
 * `auswahl` herein und geht als Ereignis wieder hinaus. Eine zweite Liste
 * hier drin hieße, dass Handy-Sammelmodus und Computer-Mehrfachauswahl
 * auseinanderlaufen — und dann bräuchte die Sammelbuchung zwei Wege.
 *
 * **Die Sortierung liegt dagegen hier drin.** Ein Klick auf den Spaltenkopf
 * ist die Sache der Tabelle; die Kartenliste hat gar keine Spaltenköpfe. Weil
 * die Anzeigereihenfolge damit hier entsteht, gibt `alle` die Ids in genau
 * dieser Reihenfolge mit — sonst passte die Auswahl nicht zum Bild.
 */
import { computed, ref } from "vue";
import { useOffeneAusgaben } from "@/composables/useOffeneAusgaben";
import { dauer, kurzeDauer } from "@/format";
import { STATUS_TEXT, type Geraet } from "@/typen";
import StatusChip from "./StatusChip.vue";
import Symbol from "./Symbol.vue";

const props = defineProps<{
  /** Die bereits gefilterten und gesuchten Geräte. */
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
  /** Kopfkästchen: alle sichtbaren auswählen. */
  alle: [ids: string[]];
  /** Kopfkästchen: Auswahl aufheben. */
  keine: [];
}>();

/** Wie lange die Geräte schon draußen sind — eine Abfrage für alle. */
const { draussen } = useOffeneAusgaben();

// ── Sortierung ─────────────────────────────────────────────────────────────

type Schluessel = "nummer" | "bezeichnung" | "status" | "ort" | "person" | "seit";

const SPALTEN: { schluessel: Schluessel; text: string; rechts?: boolean }[] = [
  { schluessel: "nummer", text: "Nummer" },
  { schluessel: "bezeichnung", text: "Bezeichnung" },
  { schluessel: "status", text: "Status" },
  { schluessel: "ort", text: "Ort" },
  { schluessel: "person", text: "Person / Platz" },
  { schluessel: "seit", text: "Seit", rechts: true },
];

/*
 * Vorgabe ist die Nummer, aufsteigend — die Reihenfolge, in der die Etiketten
 * geklebt wurden, und die einzige, die im Bauhof jeder kennt.
 *
 * Sie deckt sich dabei mit der Trefferordnung von `bestand.suche()`: Alle
 * Etikettennummern sind fünfstellig und beginnen bei 10001, also stehen
 * Nummern, die mit der Eingabe anfangen, ohnehin vor denen, die sie nur
 * enthalten (10010 vor 11001). Die Sortierarbeit aus AP20 geht am Computer
 * damit nicht verloren.
 */
const spalte = ref<Schluessel>("nummer");
const aufsteigend = ref(true);

function sortiereNach(schluessel: Schluessel): void {
  if (spalte.value === schluessel) {
    aufsteigend.value = !aufsteigend.value;
    return;
  }
  spalte.value = schluessel;
  aufsteigend.value = true;
}

/** Der Text, nach dem eine Spalte sortiert. `null` heißt: nichts eingetragen. */
function textVon(g: Geraet, schluessel: Schluessel): string | null {
  if (schluessel === "bezeichnung") return g.bezeichnung;
  if (schluessel === "status") return STATUS_TEXT[g.status];
  if (schluessel === "ort") return g.standort;
  if (schluessel === "person") return g.nutzer ?? g.lagerplatz;
  return null;
}

function istLeer(g: Geraet, schluessel: Schluessel): boolean {
  if (schluessel === "nummer") return !g.inventarnummer;
  if (schluessel === "seit") return !draussen.value.has(g.id);
  return !textVon(g, schluessel);
}

const sortiert = computed(() => {
  const s = spalte.value;
  const richtung = aufsteigend.value ? 1 : -1;

  return [...props.geraete].sort((a, b) => {
    /*
     * Leere Werte stehen IMMER unten, in beide Richtungen. Sonst füllt ein
     * absteigender Klick auf „Ort“ die erste Bildschirmseite mit Strichen —
     * die Sortierung wäre genau dann wertlos, wenn man sie braucht.
     */
    const leerA = istLeer(a, s);
    const leerB = istLeer(b, s);
    if (leerA !== leerB) return leerA ? 1 : -1;
    if (leerA) return 0;

    if (s === "nummer") {
      // Als Zahl, nicht als Text: sonst käme 10100 vor 10011.
      return richtung * (Number(a.inventarnummer) - Number(b.inventarnummer));
    }
    if (s === "seit") {
      const tageA = draussen.value.get(a.id)?.tage ?? 0;
      const tageB = draussen.value.get(b.id)?.tage ?? 0;
      return richtung * (tageA - tageB);
    }
    return richtung * (textVon(a, s) ?? "").localeCompare(textVon(b, s) ?? "", "de");
  });
});

const sortierText = computed(
  () => SPALTEN.find((s) => s.schluessel === spalte.value)?.text ?? "Nummer",
);

/**
 * Die Zeilen, fertig zum Anzeigen.
 *
 * Alles, was die Vorlage sonst je Zelle nachschlagen müsste, steht hier schon
 * ausgerechnet — sonst stünde in der Vorlage viermal je Zeile derselbe Griff
 * in die Karte `draussen`, und jeder davon wäre eine Stelle, an der ein
 * fehlender Eintrag anders behandelt wird als nebenan.
 */
const zeilen = computed(() =>
  sortiert.value.map((g) => {
    const offen = draussen.value.get(g.id);
    return {
      g,
      person: g.nutzer ?? g.lagerplatz,
      seit: offen
        ? {
            kurz: kurzeDauer(offen.tage),
            lang: dauer(offen.tage),
            ueberfaellig: offen.ueberfaellig,
          }
        : null,
    };
  }),
);

// ── Auswahl ────────────────────────────────────────────────────────────────

const gewaehlt = (id: string) => props.auswahl.includes(id);

const alleGewaehlt = computed(
  () => sortiert.value.length > 0 && sortiert.value.every((g) => gewaehlt(g.id)),
);
const teilweiseGewaehlt = computed(
  () => !alleGewaehlt.value && sortiert.value.some((g) => gewaehlt(g.id)),
);

/**
 * Das Kopfkästchen meint immer die SICHTBAREN Zeilen, nicht den ganzen
 * Bestand. Wer nach „Bauhof Nord“ filtert und oben anhakt, will die zwölf
 * Geräte vom Bauhof — nicht alle 204.
 */
function kopfKaestchen(): void {
  if (alleGewaehlt.value) {
    emit("keine");
    return;
  }
  emit(
    "alle",
    sortiert.value.map((g) => g.id),
  );
}
</script>

<template>
  <div class="geraetetabelle">
    <div
      class="tafel pt-karte"
      :class="{ 'tafel--ohnewahl': !waehlbar }"
      role="table"
      aria-label="Geräte"
    >
      <div class="tafel__kopfgruppe" role="rowgroup">
        <div class="tafel__zeile tafel__zeile--kopf" role="row">
          <span v-if="waehlbar" class="zelle" role="columnheader">
            <label
              class="kasten"
              :class="{ 'kasten--an': alleGewaehlt, 'kasten--teil': teilweiseGewaehlt }"
            >
              <input
                class="kasten__feld"
                type="checkbox"
                :checked="alleGewaehlt"
                :indeterminate="teilweiseGewaehlt"
                aria-label="Alle sichtbaren auswählen"
                @change="kopfKaestchen"
              />
              <Symbol v-if="alleGewaehlt" name="haken" :groesse="12" />
            </label>
          </span>

          <span
            v-for="s in SPALTEN"
            :key="s.schluessel"
            class="zelle"
            :class="[`zelle--${s.schluessel}`, { 'zelle--rechts': s.rechts }]"
            role="columnheader"
            :aria-sort="
              spalte === s.schluessel ? (aufsteigend ? 'ascending' : 'descending') : 'none'
            "
          >
            <button class="kopfknopf" type="button" @click="sortiereNach(s.schluessel)">
              {{ s.text }}
              <Symbol
                v-if="spalte === s.schluessel"
                :name="aufsteigend ? 'hoch' : 'runter'"
                :groesse="12"
              />
            </button>
          </span>
        </div>
      </div>

      <div class="tafel__koerper" role="rowgroup">
        <!--
          Die Zeile führt aufs Detail, das Kästchen nicht — deshalb hält das
          Kästchen den Klick bei sich (@click.stop). Ohne das öffnete jeder
          Haken zugleich die Gerätekarte.
        -->
        <div
          v-for="z in zeilen"
          :key="z.g.id"
          class="tafel__zeile"
          :class="{ 'tafel__zeile--gewaehlt': gewaehlt(z.g.id) }"
          role="row"
          tabindex="0"
          @click="emit('oeffnen', z.g.id)"
          @keydown.enter="emit('oeffnen', z.g.id)"
          @keydown.space.prevent="emit('oeffnen', z.g.id)"
        >
          <span v-if="waehlbar" class="zelle" role="cell" @click.stop>
            <label class="kasten" :class="{ 'kasten--an': gewaehlt(z.g.id) }">
              <input
                class="kasten__feld"
                type="checkbox"
                :checked="gewaehlt(z.g.id)"
                :aria-label="`${z.g.bezeichnung} auswählen`"
                @change="emit('umschalten', z.g.id)"
              />
              <Symbol v-if="gewaehlt(z.g.id)" name="haken" :groesse="12" />
            </label>
          </span>

          <span class="zelle pt-mono" role="cell">{{ z.g.inventarnummer ?? "—" }}</span>
          <span class="zelle zelle--kurz" role="cell">{{ z.g.bezeichnung }}</span>
          <span class="zelle" role="cell"><StatusChip :status="z.g.status" /></span>
          <span class="zelle zelle--kurz" role="cell">
            <template v-if="z.g.standort">{{ z.g.standort }}</template>
            <span v-else class="leerwert">—</span>
          </span>
          <span class="zelle zelle--kurz zelle--person" role="cell">
            <template v-if="z.person">{{ z.person }}</template>
            <span v-else class="leerwert">—</span>
          </span>
          <span class="zelle zelle--rechts zelle--seit" role="cell">
            <span
              v-if="z.seit"
              class="pt-mono"
              :class="{ 'seit--ueberfaellig': z.seit.ueberfaellig }"
              :title="z.seit.lang"
            >
              {{ z.seit.kurz }}
            </span>
            <span v-else class="leerwert">—</span>
          </span>
        </div>
      </div>

      <div class="tafel__fuss">
        <span>
          {{ sortiert.length }} sichtbar — die Liste wird vollständig geladen und im Browser
          gefiltert.
        </span>
        <span class="pt-mono">Sortiert nach {{ sortierText }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Die Wurzel füllt ihre Spalte; die Zeilen scrollen INNERHALB der Karte.
 * Ohne das wanderten Spaltenköpfe und Fußzeile beim Blättern aus dem Bild —
 * nach dem dritten Bildschirm wüsste niemand mehr, welche Spalte welche ist.
 */
.geraetetabelle {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.tafel {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  background: var(--surface);
  /*
   * Bezugsrahmen für die Spaltenabfrage weiter unten: Wie breit die Tabelle
   * ist, hängt nicht am Fenster, sondern daran, ob das Sammelpanel offen
   * ist. Eine Medienabfrage aufs Fenster ginge hier also am Problem vorbei.
   */
  container-type: inline-size;
}

.tafel__kopfgruppe,
.tafel__fuss {
  flex: none;
}

.tafel__koerper {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.tafel__zeile {
  display: grid;
  grid-template-columns: 32px 88px minmax(0, 1fr) 120px 190px 150px 76px;
  align-items: center;
  gap: var(--space-4);
  min-height: 48px;
  padding: 0 var(--space-5);
  font-size: var(--fs-14);
  color: var(--fg-body);
  border-top: 1px solid var(--hairline);
  cursor: pointer;
}
/*
 * Ohne das Recht `buchungen.erfassen` entfällt die Auswahlspalte ganz — eine
 * leere 32-px-Spalte sähe aus wie ein Fehler.
 */
.tafel--ohnewahl .tafel__zeile {
  grid-template-columns: 88px minmax(0, 1fr) 120px 190px 150px 76px;
}
/*
 * Wird es eng, fallen „Person / Platz" und „Seit" weg.
 *
 * Der Grund kam erst im Browser ans Licht: Bei geöffnetem Sammelpanel
 * bleiben von 1440 px nur rund 710 px für die Tabelle, die sieben Spalten
 * brauchen aber 752 px allein an festen Breiten und Abständen. Die
 * Bezeichnungsspalte ist die einzige flexible — sie schrumpfte deshalb auf
 * NULL, und ausgerechnet der Gerätename war weg, während der Rest quer
 * herausragte. Ein Untergrenze allein hätte nur die Tabelle zum seitlichen
 * Rollen gebracht; beim Zusammenstellen einer Ausgabe will niemand quer
 * scrollen.
 *
 * Gehen müssen die zwei, die beim Bestücken am wenigsten sagen: Wer gerade
 * auswählt, sieht auf Nummer, Bezeichnung, Zustand und Ort. Wer war und
 * seit wann, steht auf der Gerätekarte.
 */
@container (max-width: 780px) {
  .tafel__zeile {
    grid-template-columns: 32px 88px minmax(120px, 1fr) 120px 190px;
  }
  .tafel--ohnewahl .tafel__zeile {
    grid-template-columns: 88px minmax(120px, 1fr) 120px 190px;
  }
  .zelle--person,
  .zelle--seit {
    display: none;
  }
}

.tafel__zeile:hover {
  background: var(--surface-subtle);
}
.tafel__zeile--gewaehlt,
.tafel__zeile--gewaehlt:hover {
  background: var(--surface-muted);
}

.tafel__zeile--kopf,
.tafel__zeile--kopf:hover {
  min-height: 40px;
  background: var(--surface-subtle);
  border-top: 0;
  border-bottom: 1px solid var(--border);
  cursor: default;
}

.zelle {
  min-width: 0;
  overflow: hidden;
}
/*
 * Ein langer Gerätename darf die Spalte nicht sprengen — er wird gekürzt, die
 * vollständige Bezeichnung steht auf der Gerätekarte.
 */
.zelle--kurz {
  white-space: nowrap;
  text-overflow: ellipsis;
}
.zelle--rechts {
  text-align: right;
}

.tafel__zeile--kopf .zelle {
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--fg-subtle);
}

.kopfknopf {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;
  padding: 0;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  color: inherit;
  background: none;
  border: 0;
  cursor: pointer;
}
.kopfknopf:hover {
  color: var(--fg-muted);
}
/* Bei der rechtsbündigen Spalte steht der Sortierpfeil links vom Wort. */
.zelle--rechts .kopfknopf {
  flex-direction: row-reverse;
}

/* ── Auswahlkästchen ────────────────────────────────────────────────────── */
.kasten {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--accent-fg);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.kasten--an {
  background: var(--accent);
  border-color: var(--accent);
}
/*
 * Der Balken statt eines Hakens heißt „einige, aber nicht alle“. Ein
 * Kopfkästchen, das bei drei von zwölf gewählten Zeilen leer aussieht,
 * behauptet, es sei nichts gewählt — und der nächste Klick wählt dann alles
 * aus statt nichts.
 */
.kasten--teil::after {
  content: "";
  width: 8px;
  height: 2px;
  background: var(--fg-muted);
  border-radius: var(--radius-xs);
}
/* Der Haken kommt aus Symbol.vue mit stroke-width 1.75 — auf 12 px zu dünn. */
.kasten :deep(svg) {
  stroke-width: 3;
}
/* Das echte Feld bleibt liegen (Tastatur, Vorlesehilfe), nur unsichtbar. */
.kasten__feld {
  position: absolute;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
/*
 * Der Fokusring gehört an das SICHTBARE Kästchen. Am Feld selbst läge er auf
 * einer durchsichtigen Fläche und wäre damit unsichtbar — genau die Stelle,
 * an der ein Fokusring gebraucht wird.
 */
.kasten:has(.kasten__feld:focus-visible) {
  outline: 2px solid var(--fg);
  outline-offset: 2px;
}

.leerwert {
  color: var(--fg-subtle);
}
.seit--ueberfaellig {
  color: var(--danger-fg);
}

.tafel__fuss {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-5);
  font-size: var(--fs-13);
  color: var(--fg-muted);
  border-top: 1px solid var(--border);
}
</style>
