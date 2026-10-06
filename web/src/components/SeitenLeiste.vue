<script setup lang="ts">
/**
 * Die Navigationsleiste der Computer-Oberfläche.
 *
 * Am Handy sitzt die Navigation unten (der Daumen erreicht den oberen Rand
 * nicht) — am Schreibtisch ist das falsch: Dort gibt es keinen Daumen, dafür
 * Platz in der Breite und deutlich mehr Ziele, als vier Reiter fassen.
 *
 * Die Leiste bleibt **in beiden Themen dunkel**. Das ist aus PATIO
 * übernommen und hat einen praktischen Grund: Sie ist Orientierung, kein
 * Inhalt. Ein dunkler Streifen links tritt zurück, ein heller konkurriert
 * mit der Liste daneben.
 *
 * `Scannen` fehlt hier bewusst: Die Kamera braucht einen Secure Context und
 * eine Hand am Gerät — das bleibt Sache des Handys. Die Übersicht verweist
 * darauf.
 */
import { computed } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useBreite } from "@/composables/useBreite";
import { darfNach } from "@/rechte-pfade";
import { useAnmeldung } from "@/stores/anmeldung";
import Symbol from "./Symbol.vue";
import type { SymbolName } from "./symbole";

const route = useRoute();
const router = useRouter();
const anmeldung = useAnmeldung();
/*
 * Am iPad wachsen die Einträge von 36 auf 44 px. Die Abfrage kommt aus dem
 * Composable und nicht als zweite Medienabfrage ins CSS — genau dafür ist
 * es da. Nötig ist es, weil die neun Einträge nur 2 px Abstand haben: Mit
 * dem Finger landet man sonst auf dem Nachbarn, und das ist der Weg zu
 * jeder anderen Ansicht.
 */
const { tablet } = useBreite();

const props = defineProps<{
  /** Wie viele Prüfungen sind überfällig? Erscheint als Zähler am Eintrag. */
  faellig?: number;
  /** Name des Mandanten unter dem Titel. */
  firma?: string;
}>();

/*
 * Ein Eintrag trägt seinen Pfad, nicht sein Recht.
 *
 * Bis zu dieser Runde stand beides nebeneinander — Pfad und Recht als zwei
 * Literale je Zeile. Sie stimmten überein, aber nur zufällig: Ändert sich das
 * Recht einer Route, laufen sie auseinander, und kein Test bemerkt es. Welches
 * Recht ein Ziel verlangt, steht jetzt an genau einer Stelle
 * (`rechte-pfade.ts`), und Handy („Mehr") wie Computer lesen daraus.
 */
interface Eintrag {
  pfad: string;
  text: string;
  symbol: SymbolName;
  zaehler?: boolean;
}

const GRUPPEN: { titel: string; eintraege: Eintrag[] }[] = [
  {
    titel: "Bestand",
    eintraege: [
      { pfad: "/uebersicht", text: "Übersicht", symbol: "uebersicht" },
      { pfad: "/geraete", text: "Geräte", symbol: "liste" },
      { pfad: "/board", text: "Board", symbol: "board" },
      { pfad: "/orte", text: "Orte und Regale", symbol: "ort" },
      { pfad: "/pruefungen", text: "Prüfungen", symbol: "kalender", zaehler: true },
      { pfad: "/pakete", text: "Pakete", symbol: "paket" },
    ],
  },
  {
    titel: "Verwaltung",
    eintraege: [
      { pfad: "/etiketten", text: "Etiketten", symbol: "etikett" },
      { pfad: "/austausch", text: "Import und Export", symbol: "austausch" },
      { pfad: "/stammdaten", text: "Schlagworte und Prüfarten", symbol: "einstellungen" },
      { pfad: "/benutzer", text: "Benutzer und Rollen", symbol: "benutzer" },
      { pfad: "/logbuch", text: "Logbuch", symbol: "logbuch" },
    ],
  },
];

const gruppen = computed(() =>
  GRUPPEN.map((g) => ({
    ...g,
    eintraege: g.eintraege.filter((e) => darfNach(e.pfad)),
  })).filter((g) => g.eintraege.length),
);

const istAktiv = (pfad: string) => route.path === pfad || route.path.startsWith(pfad + "/");

/** Initialen für den Kreis im Fuß — „Julius Sima" wird zu „JS". */
const initialen = computed(() => {
  const name = anmeldung.benutzer?.anzeigename ?? "";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((t) => t[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
});

async function abmelden(): Promise<void> {
  await anmeldung.abmelden();
  void router.push("/anmelden");
}
</script>

<template>
  <aside class="seitenleiste" :class="{ 'seitenleiste--tablet': tablet }" aria-label="Hauptnavigation">
    <div class="seitenleiste__kopf">
      <span class="seitenleiste__zeichen"><Symbol name="scan" :groesse="20" /></span>
      <div class="seitenleiste__marke">
        <div class="seitenleiste__titel">Geräte-Tracker</div>
        <div class="seitenleiste__firma">{{ props.firma ?? "SIMA INFRA Construction" }}</div>
      </div>
    </div>

    <nav class="seitenleiste__nav">
      <div v-for="g in gruppen" :key="g.titel" class="gruppe">
        <div class="gruppe__titel">{{ g.titel }}</div>
        <RouterLink
          v-for="e in g.eintraege"
          :key="e.pfad"
          :to="e.pfad"
          class="eintrag"
          :class="{ 'eintrag--aktiv': istAktiv(e.pfad) }"
          :aria-current="istAktiv(e.pfad) ? 'page' : undefined"
        >
          <span class="eintrag__inhalt">
            <Symbol :name="e.symbol" :groesse="16" />
            {{ e.text }}
          </span>
          <span v-if="e.zaehler && props.faellig" class="eintrag__zaehler">{{ props.faellig }}</span>
        </RouterLink>
      </div>
    </nav>

    <div class="seitenleiste__fuss">
      <span class="fuss__kreis">{{ initialen }}</span>
      <div class="fuss__wer">
        <div class="fuss__name">{{ anmeldung.benutzer?.anzeigename }}</div>
        <div class="fuss__rolle">{{ anmeldung.benutzer?.rolle }}</div>
      </div>
      <button class="fuss__abmelden" aria-label="Abmelden" @click="abmelden">
        <Symbol name="abmelden" :groesse="16" />
      </button>
    </div>
  </aside>
</template>

<style scoped>
/*
 * Die Klassen heißen `seitenleiste`, NICHT `leiste`.
 *
 * `AppShell.vue` hat eine Regel `.leiste { position: fixed; bottom: 0;
 * height: 60px }` für die untere Leiste des Handys. Vue vergibt das
 * scoped-Attribut der Elternkomponente auch an das WURZELELEMENT des Kindes
 * — diese Regel griff damit auf die Seitenleiste durch und drückte sie als
 * 60 px hohen Streifen an den unteren Rand. Beim Bauen genau so passiert und
 * nur im Browser zu sehen: Der Übersetzer prüft keine Klassennamen.
 *
 * Die Farben stehen hier als feste Werte, nicht als Tokens: Die Leiste ist
 * die einzige Fläche, die in BEIDEN Themen dunkel bleibt. Über
 * --surface & Co. wäre sie im hellen Modus weiß.
 */
.seitenleiste {
  display: flex;
  flex-direction: column;
  width: 240px;
  flex: none;
  height: 100dvh;
  background: #0f0f11;
  border-right: 1px solid #27272a;
}

.seitenleiste__kopf {
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--topleiste-hoehe);
  flex: none;
  padding: 0 var(--space-4);
  border-bottom: 1px solid #1d1d20;
}
.seitenleiste__zeichen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: #f4f4f5;
  flex: none;
}
.seitenleiste__marke {
  min-width: 0;
}
.seitenleiste__titel {
  font-size: var(--fs-14);
  font-weight: var(--fw-semibold);
  letter-spacing: -0.015em;
  color: #f4f4f5;
}
.seitenleiste__firma {
  font-size: var(--fs-11);
  color: #71717a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seitenleiste__nav {
  flex: 1;
  padding: var(--space-4) var(--space-2);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  overflow-y: auto;
}
.gruppe {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.gruppe__titel {
  padding: 0 var(--space-2) 6px;
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #52525b;
}

.eintrag {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 36px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-md);
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: #a1a1aa;
  /* Hover ist ein Farbwechsel, kein Versatz — ein Tempo, eine Kurve. */
  transition: color var(--t-fast) var(--ease), background var(--t-fast) var(--ease);
}
.eintrag:hover {
  color: #e4e4e7;
}
.eintrag--aktiv {
  color: #f4f4f5;
  background: #1f1f23;
}
.eintrag__inhalt {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.eintrag__inhalt :deep(svg) {
  opacity: 0.8;
  flex: none;
}
/*
 * 44 px mit dem Finger. Der Platz ist da: Neun Einträge zu 44 px plus
 * Gruppenlabels brauchen rund 502 px, dazu Kopf und Fuß — auf einem iPad
 * quer (768 px hoch) bleibt Luft.
 */
.seitenleiste--tablet .eintrag {
  height: 44px;
}
/* Das kleinste Ziel der ganzen Oberfläche — und es meldet ab. */
.seitenleiste--tablet .fuss__abmelden {
  width: 44px;
  height: 44px;
}

.eintrag__zaehler {
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  color: #f87171;
  background: #2a0d0d;
}

.seitenleiste__fuss {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid #1d1d20;
}
.fuss__kreis {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--radius-full);
  background: #27272a;
  color: #e4e4e7;
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
}
.fuss__wer {
  flex: 1;
  min-width: 0;
}
.fuss__name {
  font-size: var(--fs-13);
  color: #e4e4e7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fuss__rolle {
  font-size: var(--fs-11);
  color: #71717a;
}
.fuss__abmelden {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: var(--radius-md);
  color: #71717a;
  cursor: pointer;
  transition: color var(--t-fast) var(--ease);
}
.fuss__abmelden:hover {
  color: #e4e4e7;
}
</style>
