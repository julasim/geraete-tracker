<script setup lang="ts">
/**
 * Die Startseite am Computer.
 *
 * Sie beantwortet die drei Fragen, die morgens im Büro anstehen: Was ist im
 * Bestand, was ist überfällig, was ist draußen. Alles darunter ist einen
 * Klick entfernt.
 *
 * **Am Handy gibt es diese Ansicht nicht.** Dort führt „Mehr" dieselben
 * Kennzahlen, nur untereinander statt nebeneinander — eine fünfspaltige
 * Reihe auf 390 px wären fünf unlesbare Spalten. Der Umbruchpunkt lenkt
 * darauf um, statt hier eine zweite Haltung einzubauen.
 *
 * **Scannen fehlt bewusst**: Die Kamera braucht einen Secure Context und
 * eine Hand am Gerät. Der Hinweis unten sagt genau das.
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api } from "@/api";
import { ampelKlasse, dauer, frist } from "@/format";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { FaelligePruefung, OffeneAusgabe, SicherungsStand } from "@/typen";
import Symbol from "@/components/Symbol.vue";

const bestand = useBestand();
const anmeldung = useAnmeldung();

const faellige = ref<FaelligePruefung[]>([]);
const offene = ref<OffeneAusgabe[]>([]);
const sicherung = ref<SicherungsStand | null>(null);
const laedt = ref(true);

/** Wie viele Zeilen die beiden Karten zeigen, bevor sie weiterverweisen. */
const SICHTBAR = 6;

const zahlen = computed(() => bestand.zahlen);
const ueberfaellig = computed(() => faellige.value.filter((p) => p.ampel === "ueberfaellig").length);
const ueberzogen = computed(() => offene.value.filter((o) => o.ueberfaellig).length);

onMounted(async () => {
  await bestand.laden();
  const [p, o] = await Promise.all([
    api.get<FaelligePruefung[]>("/pruefungen/faellig").catch(() => []),
    api.get<OffeneAusgabe[]>("/buchungen/offen").catch(() => []),
  ]);
  faellige.value = p;
  offene.value = o;
  laedt.value = false;

  if (anmeldung.darf("benutzer.verwalten")) {
    // Ohne das Recht antwortet die Route mit 403 — den Zustand der Anlage
    // geht ein Mitarbeiter auf der Baustelle nichts an.
    sicherung.value = await api.get<SicherungsStand | null>("/sicherung/stand").catch(() => null);
  }
});

/** Grün, gelb, rot — dieselbe Ampel wie unter „Mehr" am Handy. */
const sicherungsKlasse = computed(() => {
  const s = sicherung.value;
  if (!s || s.ausgang === "fehler") return "pt-meldung--fehler";
  if (s.tage_her >= 3) return "pt-meldung--fehler";
  if (s.tage_her >= 1) return "pt-meldung--warnung";
  return "pt-meldung--erfolg";
});

const sicherungsText = computed(() => {
  const s = sicherung.value;
  if (!s) return "Noch nie gesichert — der nächtliche Lauf ist nicht eingerichtet.";
  if (s.ausgang === "fehler") return `Letzte Sicherung fehlgeschlagen: ${s.meldung}`;
  if (s.tage_her === 0) return "Heute gesichert.";
  if (s.tage_her === 1) return "Gestern gesichert.";
  return `Zuletzt vor ${s.tage_her} Tagen gesichert.`;
});
</script>

<template>
  <div>
    <header class="topbar">
      <div>
        <h1 class="topbar__titel">Übersicht</h1>
        <p class="topbar__unter">{{ anmeldung.benutzer?.anzeigename }}</p>
      </div>
    </header>

    <div class="inhalt">
      <!-- ── Kennzahlen ──────────────────────────────────────── -->
      <div class="kennzahlen">
        <RouterLink to="/geraete" class="kennzahl">
          <div class="kennzahl__wert">{{ zahlen.gesamt }}</div>
          <div class="kennzahl__label">Im Bestand</div>
        </RouterLink>
        <RouterLink to="/geraete?status=verfuegbar" class="kennzahl">
          <div class="kennzahl__wert">{{ zahlen.verfuegbar }}</div>
          <div class="kennzahl__label">Verfügbar</div>
        </RouterLink>
        <RouterLink to="/geraete?status=ausgegeben" class="kennzahl">
          <div class="kennzahl__wert">{{ zahlen.ausgegeben }}</div>
          <div class="kennzahl__label">Ausgegeben</div>
        </RouterLink>
        <RouterLink to="/pruefungen" class="kennzahl">
          <div class="kennzahl__wert" :class="{ 'kennzahl__wert--warnung': ueberfaellig }">
            {{ ueberfaellig }}
          </div>
          <div class="kennzahl__label">Prüfungen überfällig</div>
        </RouterLink>
        <RouterLink to="/geraete?status=ausgegeben" class="kennzahl">
          <div class="kennzahl__wert" :class="{ 'kennzahl__wert--warnung': ueberzogen }">
            {{ ueberzogen }}
          </div>
          <div class="kennzahl__label">Rückgabe überschritten</div>
        </RouterLink>
      </div>

      <!-- ── Zwei Karten ─────────────────────────────────────── -->
      <div class="spalten">
        <section class="pt-karte karte">
          <div class="karte__kopf">
            <h2 class="karte__titel">Prüfungen stehen an</h2>
            <span class="karte__anzahl">{{ faellige.length }}</span>
          </div>

          <p v-if="laedt" class="pt-leer">Wird geladen …</p>
          <p v-else-if="!faellige.length" class="pt-leer">Nichts fällig.</p>
          <ul v-else class="pt-liste">
            <li v-for="p in faellige.slice(0, SICHTBAR)" :key="`${p.geraet_id}-${p.pruefart}`">
              <RouterLink :to="`/geraete/${p.geraet_id}`" class="pt-zeile zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ p.bezeichnung }}</div>
                  <div class="pt-zeile__unter">
                    <span class="pt-mono">{{ p.inventarnummer }}</span> · {{ p.pruefart }}
                  </div>
                </div>
                <span class="pt-chip" :class="ampelKlasse(p.ampel)">
                  {{ frist(p.tage_bis_faellig) }}
                </span>
              </RouterLink>
            </li>
            <li v-if="faellige.length > SICHTBAR">
              <RouterLink to="/pruefungen" class="pt-zeile zeile weiter">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Alle {{ faellige.length }} Fristen zeigen</div>
                </div>
                <Symbol name="weiter" :groesse="18" />
              </RouterLink>
            </li>
          </ul>
        </section>

        <section class="pt-karte karte">
          <div class="karte__kopf">
            <h2 class="karte__titel">Derzeit draußen</h2>
            <span class="karte__anzahl">{{ offene.length }}</span>
          </div>

          <p v-if="laedt" class="pt-leer">Wird geladen …</p>
          <p v-else-if="!offene.length" class="pt-leer">Alles im Lager.</p>
          <ul v-else class="pt-liste">
            <li v-for="o in offene.slice(0, SICHTBAR)" :key="o.geraet_id">
              <RouterLink :to="`/geraete/${o.geraet_id}`" class="pt-zeile zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ o.bezeichnung }}</div>
                  <div class="pt-zeile__unter">
                    {{ o.standort
                    }}<template v-if="o.empfaenger"> · {{ o.empfaenger }}</template>
                  </div>
                </div>
                <span
                  class="pt-chip"
                  :class="o.ueberfaellig ? 'pt-chip--defekt' : 'pt-chip--neutral'"
                >
                  {{ dauer(o.tage) }}
                </span>
              </RouterLink>
            </li>
            <li v-if="offene.length > SICHTBAR">
              <RouterLink to="/geraete?status=ausgegeben" class="pt-zeile zeile weiter">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Alle {{ offene.length }} zeigen</div>
                </div>
                <Symbol name="weiter" :groesse="18" />
              </RouterLink>
            </li>
          </ul>

          <p
            v-if="anmeldung.darf('benutzer.verwalten')"
            class="pt-meldung karte__fuss"
            :class="sicherungsKlasse"
          >
            {{ sicherungsText }}
          </p>
        </section>
      </div>

      <p class="pt-gedaempft hinweis">
        Scannen und Buchen am Gerät geht am Handy — die Kamera braucht eine gesicherte
        Verbindung und eine Hand am Etikett.
      </p>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 56px;
  padding: 0 var(--space-6);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.topbar__titel {
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
  letter-spacing: -0.015em;
  color: var(--fg);
}
.topbar__unter {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.inhalt {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.kennzahlen {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: var(--space-4);
}
.kennzahl {
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: border-color var(--t-fast) var(--ease);
}
.kennzahl:hover {
  border-color: var(--border-strong);
}
.kennzahl__wert {
  font-size: var(--fs-30);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.015em;
  color: var(--fg);
}
/* Nur wenn wirklich etwas ansteht — eine rote Null wäre ein Fehlalarm. */
.kennzahl__wert--warnung {
  color: var(--danger-fg);
}
.kennzahl__label {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.spalten {
  display: grid;
  grid-template-columns: 1.15fr 1fr;
  gap: var(--space-6);
  align-items: start;
}
.karte {
  padding: 0;
  overflow: hidden;
}
.karte__kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--hairline);
}
.karte__titel {
  font-size: var(--fs-15);
  font-weight: var(--fw-semibold);
}
.karte__anzahl {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.zeile {
  padding: var(--space-3) var(--space-5);
}
.weiter {
  color: var(--fg-muted);
}
.karte__fuss {
  margin: var(--space-3) var(--space-5) var(--space-4);
}

.hinweis {
  font-size: var(--fs-13);
}

/*
 * Unter 1024 px führt der Umbruchpunkt auf „Mehr" um — diese Ansicht ist
 * dann nicht zu sehen. Die Regel steht trotzdem hier: Wer die Adresse
 * direkt aufruft, soll keine fünfspaltige Reihe auf einem Handy bekommen.
 */
@media (max-width: 1023px) {
  .kennzahlen {
    grid-template-columns: repeat(2, 1fr);
  }
  .spalten {
    grid-template-columns: 1fr;
  }
  .inhalt,
  .topbar {
    padding-left: var(--space-4);
    padding-right: var(--space-4);
  }
}
</style>
