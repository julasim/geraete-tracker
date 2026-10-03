<script setup lang="ts">
/**
 * Die Geräteliste. Sucht und filtert im Browser — der ganze Bestand ist
 * bereits geladen, ein Serveraufruf je Tastendruck wäre auf der Baustelle
 * spürbar langsamer.
 *
 * **Zwei Haltungen, eine Ansicht.** Unter 1024 px die Kartenliste mit
 * 48-px-Tippzielen wie bisher; ab 1024 px die dichte Tabelle mit
 * Mehrfachauswahl und der Sammelausgabe als Spalte daneben. Dieselben Daten,
 * dieselbe Suche, dieselben Filter — nur die Dichte unterscheidet sich, weil
 * am Schreibtisch verglichen und in Mengen gearbeitet wird.
 *
 * **Die Mehrfachauswahl ist der Sammelmodus des Scanners.** Sie liegt in
 * `bestand.sammlung`, genau wie am Handy. Eine zweite Auswahl hier hätte
 * bedeutet, dass die Sammelbuchung zwei Wege braucht — und zwei Wege in eine
 * Buchung sind zwei Gelegenheiten, den Bestand falsch zu machen.
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useBestand } from "@/stores/bestand";
import type { GeraetStatus } from "@/typen";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBreite } from "@/composables/useBreite";
import GeraeteKarten from "@/components/GeraeteKarten.vue";
import GeraeteTabelle from "@/components/GeraeteTabelle.vue";
import Kopf from "@/components/Kopf.vue";
import SammelPanel from "@/components/SammelPanel.vue";
import StatusChip from "@/components/StatusChip.vue";
import SuchKnopf from "@/components/SuchKnopf.vue";
import Symbol from "@/components/Symbol.vue";
import TopLeiste from "@/components/TopLeiste.vue";

const bestand = useBestand();
const router = useRouter();
const anmeldung = useAnmeldung();
const { breit, tablet } = useBreite();

const suchtext = ref("");
const FILTER: { wert: GeraetStatus | "alle"; text: string }[] = [
  { wert: "alle", text: "Alle" },
  { wert: "verfuegbar", text: "Verfügbar" },
  { wert: "ausgegeben", text: "Ausgegeben" },
  { wert: "defekt", text: "Defekt" },
];

/*
 * Am Computer kommt „In Wartung" als fünfte Kachel dazu: In der Filterleiste
 * ist Platz dafür, in der scrollenden Handy-Leiste nicht — dort rutschte
 * schon „Defekt" aus dem Bild, sobald die Knöpfe größer wurden (AP20).
 */
const FILTER_BREIT: typeof FILTER = [...FILTER, { wert: "wartung", text: "In Wartung" }];

/**
 * Der Filter lässt sich über die Adresse vorbelegen (`/geraete?status=ausgegeben`).
 * So kann die Übersicht auf die vollständige Liste der ausgegebenen Geräte
 * verweisen, statt eine zweite Liste zu führen, die dasselbe zeigt.
 *
 * Geprüft wird weiterhin gegen `FILTER`, nicht gegen `FILTER_BREIT`: Die
 * fünfte Kachel ist eine Zutat der Computeransicht, und ein Adressparameter
 * soll auf beiden Haltungen dasselbe bedeuten.
 */
const route = useRoute();
const ausAdresse = route.query.status;
const filter = ref<GeraetStatus | "alle">(
  typeof ausAdresse === "string" && FILTER.some((f) => f.wert === ausAdresse)
    ? (ausAdresse as GeraetStatus)
    : "alle",
);

const ortFilter = ref("");
const schlagwortFilter = ref("");
const herstellerFilter = ref("");

const hersteller = computed(() => {
  const namen = new Set<string>();
  for (const g of bestand.geraete) {
    if (g.hersteller) namen.add(g.hersteller);
  }
  return [...namen].sort((a, b) => a.localeCompare(b, "de"));
});

/** Alles außer dem Statusfilter — die Grundlage für Liste UND Zählwerte. */
const gesucht = computed(() => {
  let treffer = bestand.suche(suchtext.value);
  if (ortFilter.value) {
    treffer = treffer.filter((g) => g.aktueller_standort_id === ortFilter.value);
  }
  if (schlagwortFilter.value) {
    treffer = treffer.filter((g) => g.schlagworte.some((w) => w.id === schlagwortFilter.value));
  }
  if (herstellerFilter.value) {
    treffer = treffer.filter((g) => g.hersteller === herstellerFilter.value);
  }
  return treffer;
});

const gefiltert = computed(() =>
  filter.value === "alle" ? gesucht.value : gesucht.value.filter((g) => g.status === filter.value),
);

/*
 * Die Zahlen in den Kacheln zählen die SUCHTREFFER, nicht den ganzen Bestand.
 * Sonst stünde neben „Verfügbar" weiter 126, während die Suche nach „Hilti"
 * nur vier Geräte übrig lässt — und die Kachel behauptete etwas, das die
 * Liste widerlegt.
 */
const zaehler = computed(() => {
  const treffer = gesucht.value;
  const zaehle = (s: GeraetStatus) => treffer.filter((g) => g.status === s).length;
  return {
    alle: treffer.length,
    verfuegbar: zaehle("verfuegbar"),
    ausgegeben: zaehle("ausgegeben"),
    defekt: zaehle("defekt"),
    wartung: zaehle("wartung"),
    ausgemustert: zaehle("ausgemustert"),
  };
});

// ── Mehrfachauswahl ────────────────────────────────────────────────────────

const darfSammeln = computed(() => anmeldung.darf("buchungen.erfassen"));
const panelOffen = computed(() => breit.value && darfSammeln.value && bestand.sammelt);

function umschalten(id: string): void {
  if (bestand.sammlung.includes(id)) bestand.entsammle(id);
  else bestand.sammle(id);
}

function alleWaehlen(ids: string[]): void {
  for (const id of ids) bestand.sammle(id);
}

/*
 * Nach dem Buchen schließt sich die Spalte, und die gebuchten Zeilen stehen
 * neu da. Ohne einen Satz dazu bliebe offen, ob überhaupt etwas passiert ist.
 */
const bestaetigung = ref<string | null>(null);
let uhr: ReturnType<typeof setTimeout> | null = null;

function gebucht(anzahl: number): void {
  bestaetigung.value = `${anzahl} Gerät${anzahl === 1 ? "" : "e"} ausgegeben.`;
  if (uhr) clearTimeout(uhr);
  uhr = setTimeout(() => (bestaetigung.value = null), 8000);
}

onUnmounted(() => {
  if (uhr) clearTimeout(uhr);
});

onMounted(() => void bestand.laden());
</script>

<template>
  <div class="geraeteseite" :class="{ 'geraeteseite--breit': breit }">
    <!-- ── Handy: Kopfzeile oben, Navigation unten ──────────────────────── -->
    <template v-if="!breit">
      <Kopf titel="Geräte" :unter="`${bestand.geraete.length} im Bestand`">
        <template #rechts>
          <button
            v-if="anmeldung.darf('geraete.pflegen')"
            class="pt-btn neu"
            aria-label="Gerät anlegen"
            @click="router.push('/geraete/neu')"
          >
            Neu
          </button>
        </template>
      </Kopf>

      <div class="werkzeuge">
        <div class="suchfeld">
          <Symbol name="suche" :groesse="18" />
          <input
            v-model="suchtext"
            class="pt-feld suchfeld__eingabe"
            type="search"
            placeholder="Bezeichnung, Nummer, Ort …"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>

        <div class="filter" role="group" aria-label="Filter">
          <button
            v-for="f in FILTER"
            :key="f.wert"
            class="filter__knopf"
            :class="{ 'filter__knopf--aktiv': filter === f.wert }"
            :aria-pressed="filter === f.wert"
            @click="filter = f.wert"
          >
            {{ f.text }}
          </button>
        </div>

        <div class="zusatzfilter">
          <select v-model="ortFilter" class="pt-feld zusatzfilter__feld" aria-label="Ort">
            <option value="">Ort: alle</option>
            <option v-for="s in bestand.aktiveStandorte" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>

          <select v-if="bestand.schlagworte.length" v-model="schlagwortFilter" class="pt-feld zusatzfilter__feld" aria-label="Schlagwort">
            <option value="">Schlagwort: alle</option>
            <option v-for="w in bestand.schlagworte" :key="w.id" :value="w.id">{{ w.name }}</option>
          </select>

          <select v-if="hersteller.length" v-model="herstellerFilter" class="pt-feld zusatzfilter__feld" aria-label="Hersteller">
            <option value="">Hersteller: alle</option>
            <option v-for="h in hersteller" :key="h" :value="h">{{ h }}</option>
          </select>
        </div>
      </div>

      <p v-if="bestand.laedt && !bestand.geraete.length" class="pt-leer">Wird geladen …</p>

      <p v-else-if="!gefiltert.length" class="pt-leer">
        <template v-if="bestand.geraete.length === 0">
          Noch keine Geräte erfasst.<br />
          <button
            v-if="anmeldung.darf('geraete.pflegen')"
            class="pt-btn pt-btn--primaer erstesgeraet"
            @click="router.push('/geraete/neu')"
          >
            Erstes Gerät anlegen
          </button>
        </template>
        <template v-else>Kein Gerät passt zur Suche.</template>
      </p>

      <ul v-else class="pt-liste liste">
        <li v-for="g in gefiltert" :key="g.id">
          <button class="pt-zeile" @click="router.push(`/geraete/${g.id}`)">
            <div class="pt-zeile__haupt">
              <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
              <div class="pt-zeile__unter">
                <span class="pt-mono">{{ g.inventarnummer }}</span>
                <template v-if="g.standort"> · {{ g.standort }}</template>
                <template v-if="g.nutzer"> · {{ g.nutzer }}</template>
              </div>
            </div>
            <StatusChip :status="g.status" />
          </button>
        </li>
      </ul>
    </template>

    <!-- ── Computer und iPad: Seitenleiste links, Tabelle rechts ────────── -->
    <template v-else>
      <TopLeiste
        titel="Geräte"
        :unter="
          bestand.sammelt && darfSammeln
            ? `${bestand.sammlung.length} ausgewählt`
            : `${bestand.geraete.length} im Bestand`
        "
      >
        <template #mitte>
          <!--
            Am iPad quer teilen sich Titel, Suche und „Gerät anlegen" 1024 px.
            Ein dauerhaft offenes 320-px-Feld nähme dort den Platz, den die
            Aktion braucht — also klappt die Suche dort erst auf Tippen auf.
          -->
          <SuchKnopf
            v-if="tablet"
            v-model="suchtext"
            platzhalter="Bezeichnung, Nummer, Ort, Person …"
          />
          <div v-else class="kopfsuche">
            <Symbol name="suche" :groesse="16" />
            <input
              v-model="suchtext"
              class="pt-feld kopfsuche__feld"
              type="search"
              placeholder="Bezeichnung, Nummer, Ort, Person …"
              autocapitalize="off"
              spellcheck="false"
            />
          </div>
        </template>

        <template #rechts>
          <button
            v-if="bestand.sammelt && darfSammeln"
            class="pt-btn pt-btn--still"
            @click="bestand.sammlungLeeren()"
          >
            Auswahl aufheben
          </button>
          <button
            v-else-if="anmeldung.darf('geraete.pflegen')"
            class="pt-btn pt-btn--primaer"
            @click="router.push('/geraete/neu')"
          >
            <Symbol name="plus" :groesse="16" />
            Gerät anlegen
          </button>
        </template>
      </TopLeiste>

      <!--
        Die Filterleiste bleibt auch während einer Auswahl stehen. Der Entwurf
        zeigt sie dort zwar nicht, aber wer vier Geräte gewählt hat und ein
        fünftes sucht, müsste sonst erst die Auswahl aufgeben.
      -->
      <div class="filterleiste" :class="{ 'filterleiste--tablet': tablet }">
        <button
          v-for="f in FILTER_BREIT"
          :key="f.wert"
          class="pille"
          :class="{ 'pille--aktiv': filter === f.wert }"
          :aria-pressed="filter === f.wert"
          @click="filter = f.wert"
        >
          {{ f.text }} <span class="pille__zahl">{{ zaehler[f.wert] }}</span>
        </button>

        <span class="filterleiste__trenner" />

        <select v-model="ortFilter" class="wahlfeld" aria-label="Ort">
          <option value="">Ort: alle</option>
          <option v-for="s in bestand.aktiveStandorte" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select>

        <select v-model="schlagwortFilter" class="wahlfeld" aria-label="Schlagwort">
          <option value="">Schlagwort: alle</option>
          <option v-for="w in bestand.schlagworte" :key="w.id" :value="w.id">{{ w.name }}</option>
        </select>

        <select v-if="hersteller.length" v-model="herstellerFilter" class="wahlfeld" aria-label="Hersteller">
          <option value="">Hersteller: alle</option>
          <option v-for="h in hersteller" :key="h" :value="h">{{ h }}</option>
        </select>
      </div>

      <div class="raum">
        <div class="raum__liste" :class="{ 'raum__liste--rollend': tablet }">
          <p v-if="bestaetigung" class="pt-meldung pt-meldung--erfolg">{{ bestaetigung }}</p>

          <p v-if="bestand.laedt && !bestand.geraete.length" class="pt-leer">Wird geladen …</p>

          <p v-else-if="!gefiltert.length" class="pt-leer">
            <template v-if="bestand.geraete.length === 0">
              Noch keine Geräte erfasst.<br />
              <button
                v-if="anmeldung.darf('geraete.pflegen')"
                class="pt-btn pt-btn--primaer erstesgeraet"
                @click="router.push('/geraete/neu')"
              >
                Erstes Gerät anlegen
              </button>
            </template>
            <template v-else>Kein Gerät passt zur Suche.</template>
          </p>

          <!--
            Tabelle oder Karten — beide haben denselben Vertrag, hier wird nur
            getauscht. Mit dem Finger trifft niemand eine 48 px hohe
            Tabellenzeile mit einem 18 px großen Kästchen darin, also bekommt
            das iPad dieselbe Liste in Kartenform.
          -->
          <component
            :is="tablet ? GeraeteKarten : GeraeteTabelle"
            v-else
            :geraete="gefiltert"
            :auswahl="bestand.sammlung"
            :waehlbar="darfSammeln"
            @oeffnen="(id: string) => router.push(`/geraete/${id}`)"
            @umschalten="umschalten"
            @alle="alleWaehlen"
            @keine="bestand.sammlungLeeren()"
          />
        </div>

        <SammelPanel
          v-if="panelOffen"
          @gebucht="gebucht"
          @abbrechen="bestand.sammlungLeeren()"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
/*
 * Am Handy trägt die Wurzel ausdrücklich KEINE Gestaltung — die Ansicht
 * fließt weiter im Rahmen, wie seit AP7. Nur im breiten Modus wird sie zur
 * Spalte über die volle Höhe. Der Blockname steht deshalb doppelt im
 * Selektor: Die Oberflächenprüfung verlangt für jede benutzte Klasse eine
 * Regel, und eine leere Regel wäre schwerer zu lesen als diese Zeile.
 *
 * 100dvh statt 100 %: Im breiten Modus ist `AppShell` selbst 100dvh hoch und
 * hat über dem Inhalt nichts stehen — eine Prozentangabe fände dagegen keinen
 * Elternteil mit fester Höhe und fiele auf „so hoch wie der Inhalt" zurück.
 * Dann scrollte die ganze Seite, und Kopfzeile wie Sammelspalte wanderten mit
 * aus dem Bild.
 */
.geraeteseite.geraeteseite--breit {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}

/* ── Handy (unverändert seit AP7/AP20) ───────────────────────────────────── */
.werkzeuge {
  position: sticky;
  top: var(--kopf-hoehe);
  z-index: 5;
  padding: var(--space-3) var(--space-4);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
}

.suchfeld {
  position: relative;
  display: flex;
  align-items: center;
}
.suchfeld svg {
  position: absolute;
  left: var(--space-3);
  color: var(--fg-subtle);
  pointer-events: none;
}
.suchfeld__eingabe {
  padding-left: calc(var(--space-3) * 2 + 18px);
}

.filter {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
  overflow-x: auto;
  scrollbar-width: none;
}
.filter::-webkit-scrollbar {
  display: none;
}

.filter__knopf {
  /*
   * min-height 48px: Die Projektvorgabe für Tippziele (Daumen statt Maus,
   * teils mit Handschuhen). Die Leiste kam mit der reinen Innenabstands-
   * Angabe auf 37px und war damit das kleinste Ziel der ganzen Anwendung —
   * ausgerechnet der Filter, den man auf der Baustelle im Vorbeigehen tippt.
   */
  min-height: 48px;
  display: inline-flex;
  align-items: center;
  /*
   * Seitlicher Abstand bleibt bei space-3: Mit space-4 wurden die vier
   * Filter zusammen breiter als ein 375px-Bildschirm, und "Defekt" rutschte
   * aus dem Bild. Die Leiste scrollt zwar, aber ein Filter, den man erst
   * heranziehen muss, wird nicht benutzt. Korrigiert werden sollte die
   * Höhe, nicht die Breite.
   */
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  color: var(--fg-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  cursor: pointer;
}
/* Aktiv = Ink, kein Farbakzent. */
.filter__knopf--aktiv {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: var(--accent);
}

.zusatzfilter {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
  overflow-x: auto;
  scrollbar-width: none;
}
.zusatzfilter::-webkit-scrollbar {
  display: none;
}
.zusatzfilter__feld {
  min-height: 44px;
  flex: 1;
  min-width: 0;
  font-size: var(--fs-13);
}

.neu {
  /* 48px wie alle Tippziele — siehe .filter__knopf. */
  min-height: 48px;
  padding: 0 var(--space-3);
  font-size: var(--fs-13);
}

.erstesgeraet {
  margin-top: var(--space-4);
}

.liste {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

/* ── Computer ────────────────────────────────────────────────────────────── */
.kopfsuche {
  position: relative;
  display: flex;
  align-items: center;
  width: 320px;
}
.kopfsuche svg {
  position: absolute;
  left: var(--space-3);
  color: var(--fg-subtle);
  pointer-events: none;
}
.kopfsuche__feld {
  min-height: 36px;
  /* Links: Abstand der Lupe + ihre Breite + Luft = 12 + 16 + 8. */
  padding: var(--space-2) var(--space-3) var(--space-2)
    calc(var(--space-3) + 16px + var(--space-2));
  font-size: var(--fs-14);
}

.filterleiste {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
  flex-wrap: wrap;
  padding: var(--space-3) var(--space-6);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.filterleiste__trenner {
  width: 1px;
  height: 24px;
  margin: 0 var(--space-2);
  background: var(--border);
}

.pille {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 32px;
  padding: var(--space-1) var(--space-3);
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  white-space: nowrap;
  color: var(--fg-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: border-color var(--t-fast) var(--ease);
}
.pille:hover {
  border-color: var(--border-strong);
}
/* Aktiv = Ink, wie am Handy. Es gibt keine Markenfarbe. */
.pille--aktiv,
.pille--aktiv:hover {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: var(--accent);
}
.pille__zahl {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}

.wahlfeld {
  min-height: 32px;
  padding: var(--space-1) var(--space-3);
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

/* Am iPad wird getippt, nicht geklickt: 32 px trifft man mit dem Finger nicht. */
.filterleiste--tablet .pille,
.filterleiste--tablet .wahlfeld {
  min-height: 44px;
}

.raum {
  display: flex;
  flex: 1;
  min-height: 0;
}
.raum__liste {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  flex: 1;
  min-width: 0;
  padding: var(--space-6);
  overflow: hidden;
}
/*
 * Die Tabelle rollt in sich selbst — Spaltenköpfe und Fußzeile bleiben dabei
 * stehen, deshalb ist die Spalte um sie herum geschlossen. Die Kartenliste des
 * iPads wächst dagegen mit ihrem Inhalt; dort muss die Spalte rollen, sonst
 * enden zweihundert Karten hinter dem unteren Rand, ohne einen Weg dorthin.
 */
.raum__liste--rollend {
  overflow-y: auto;
}
</style>
