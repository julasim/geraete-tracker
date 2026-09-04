<script setup lang="ts">
/**
 * Gerät anlegen — in zwei Haltungen.
 *
 * Am Handy (unter 1024 px) bleibt es, wie es war: eine Spalte, die selten
 * gebrauchten Felder hinter „Weitere Felder“, ein großer Knopf. Am Computer
 * steht links das Formular und rechts, was gerade entstanden ist.
 *
 * Beides ist auf **Erfassen in Folge** ausgelegt, und das ist hier nicht
 * eine Bequemlichkeit unter vielen, sondern der Zweck der Ansicht: Wer 200
 * Maschinen aufnimmt, sitzt eine Stunde davor. Deshalb bleibt nach dem
 * Speichern stehen, was zur **Umgebung** gehört (Ort, Lagerplatz,
 * Schlagworte), und geleert wird, was das einzelne **Gerät** beschreibt; der
 * Fokus springt zurück in die Bezeichnung — der Weg für das nächste Gerät ist
 * damit: tippen, Enter.
 *
 * **Pflicht ist ausschließlich die Bezeichnung.** Ein Gerät ohne
 * Seriennummer ist immer noch ein Gerät.
 *
 * **Die Nummer vergibt der Server** (fortlaufend ab 10001, gegen das
 * Nummernregister geprüft). Hier wird keine erzeugt, geraten oder
 * hochgezählt: Draußen kleben Etiketten, die das System noch nicht kennt —
 * eine im Browser errechnete Nummer klebte irgendwann zum zweiten Mal.
 * Von Hand eintragen geht, ist aber ausdrücklich der Ausnahmefall.
 *
 * **Ort und Lagerplatz sind ein Paar.** `POST /geraete` nimmt beides
 * entgegen und prüft, dass der Platz zum gewählten Ort gehört (sonst 409).
 * Deshalb leert ein Ortswechsel den Platz hier sofort: Bliebe das Regal des
 * vorigen Ortes stehen, zeigte das Auswahlfeld nur leer an — sein Wert steht
 * ja nicht mehr in den Optionen —, und der Server wiese ab, während im
 * Formular alles richtig aussieht. Das ist der Anfangsstandort, der einzige
 * Zustand, den das Anlegen direkt setzt; danach entsteht er nur aus Buchungen.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useBreite } from "@/composables/useBreite";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import Symbol from "@/components/Symbol.vue";
import TopLeiste from "@/components/TopLeiste.vue";

const route = useRoute();
const router = useRouter();
const bestand = useBestand();
const anmeldung = useAnmeldung();
const { breit, tablet } = useBreite();

const bezeichnung = ref("");
const hersteller = ref("");
const modell = ref("");
const seriennummer = ref("");
const inventarnummer = ref((route.query.nummer as string) ?? "");
const notiz = ref("");
const standortId = ref("");
const lagerplatzId = ref("");
const gewaehlteWorte = ref<string[]>([]);
const mehrFelder = ref(false);

/**
 * Die Plätze des gewählten Ortes. Ohne Ort keine Plätze — und ein Auswahlfeld,
 * das nur „— kein bestimmter Platz —“ enthält, lädt zum Klicken ins Nichts ein.
 * Deshalb erscheint es gar nicht erst, wenn der Ort keine Regale hat; angelegt
 * werden sie unter „Orte und Regale“.
 *
 * Dieselbe Regel — Ortwechsel leert den Platz — steht ein zweites Mal in
 * `composables/useBuchungsziel.ts` (dort fürs Buchen). Ein Zusammenlegen
 * lohnt nicht: Jenes Composable schleppt `zielOrte`, das Merken des letzten
 * Ortes und den localStorage mit, die das Anlegen alle nicht braucht.
 */
const plaetze = computed(() =>
  standortId.value ? bestand.plaetzeAmStandort(standortId.value) : [],
);

/**
 * Ortswechsel leert den Platz — siehe Kopfkommentar. Erreichbar ist der Fall
 * hier auch über „— kein Standort —“: Ohne Ort gibt es keinen gültigen Platz.
 */
watch(standortId, () => {
  lagerplatzId.value = "";
});

const speichert = ref(false);
const fehler = ref<string | null>(null);
/** Die zuletzt angelegten Geräte dieser Sitzung — Rückmeldung beim Erfassen in Folge. */
const angelegt = ref<Geraet[]>([]);

/** Wie viele davon die Liste zeigt, bevor sie den Rest zusammenfasst. */
const SICHTBAR = 10;

const bezeichnungEl = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  await bestand.laden();
  standortId.value = bestand.lager[0]?.id ?? bestand.aktiveStandorte[0]?.id ?? "";
  bezeichnungEl.value?.focus();
});

function wortUmschalten(id: string): void {
  const i = gewaehlteWorte.value.indexOf(id);
  if (i >= 0) gewaehlteWorte.value.splice(i, 1);
  else gewaehlteWorte.value.push(id);
}

/** Legt das Gerät an. Gibt zurück, ob es geklappt hat. */
async function anlegen(): Promise<boolean> {
  if (speichert.value || !bezeichnung.value.trim()) return false;
  speichert.value = true;
  fehler.value = null;

  try {
    const neu = await api.post<Geraet>("/geraete", {
      bezeichnung: bezeichnung.value.trim(),
      // Leere Felder gar nicht erst senden — der Server soll null eintragen,
      // nicht einen leeren Text.
      hersteller: hersteller.value.trim() || null,
      modell: modell.value.trim() || null,
      seriennummer: seriennummer.value.trim() || null,
      inventarnummer: inventarnummer.value.trim() || null,
      notiz: notiz.value.trim() || null,
      standort_id: standortId.value || null,
      lagerplatz_id: lagerplatzId.value || null,
      schlagworte: gewaehlteWorte.value,
    });

    bestand.ersetze(neu);
    angelegt.value.unshift(neu);
    return true;
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht angelegt werden";
    return false;
  } finally {
    speichert.value = false;
  }
}

/**
 * Anlegen und gleich das nächste erfassen.
 *
 * Standort, Lagerplatz und Schlagworte bleiben stehen — beim Erfassen einer
 * Regalreihe ändern sie sich selten, und wer sie 200 Mal neu einstellen muss,
 * hört nach zwanzig Geräten auf. Bei einem Fehler wird **nichts** geleert,
 * sonst tippt man alles noch einmal.
 */
async function speichern(): Promise<void> {
  if (!(await anlegen())) return;

  bezeichnung.value = "";
  // Der Hersteller blieb früher stehen, das Modell nicht — eine halbe Regel,
  // die beim Erfassen gemischter Regale zu falschen Angaben führt: Wer sie
  // übersieht, legt die Tauchpumpe unter „Wacker Neuson“ an. Die Trennlinie
  // läuft seither zwischen Umgebung und Gerät: Stehen bleibt, wo erfasst wird
  // (Ort, Lagerplatz, Schlagworte), geleert wird, was das einzelne Gerät
  // beschreibt. Der Lagerplatz gehört ausdrücklich zur Umgebung — wer eine
  // Regalreihe aufnimmt, legt zehn Geräte hintereinander in Regal C3.
  hersteller.value = "";
  modell.value = "";
  seriennummer.value = "";
  inventarnummer.value = "";
  notiz.value = "";
  bezeichnungEl.value?.focus();
}

/** Anlegen und die Erfassung verlassen — zurück in die Geräteliste. */
async function speichernUndSchliessen(): Promise<void> {
  if (!(await anlegen())) return;
  router.push("/geraete");
}

/**
 * Die Etikettenansicht mit genau den Geräten dieser Sitzung öffnen.
 *
 * Übergeben werden nur die Ids als Query-Parameter: Die Auswahl gehört der
 * Etikettenansicht, nicht dieser hier. Kennt sie den Parameter nicht, öffnet
 * sie wie bisher mit leerer Auswahl — es geht nichts kaputt.
 */
function zuEtiketten(): void {
  router.push({
    path: "/etiketten",
    query: { geraete: angelegt.value.map((g) => g.id).join(",") },
  });
}
</script>

<template>
  <div class="anlegen" :class="{ 'anlegen--breit': breit, 'anlegen--tablet': tablet }">
    <TopLeiste v-if="breit" titel="Gerät anlegen" zurueck>
      <template #rechts>
        <span class="nummernhinweis">Die Nummer vergibt der Server fortlaufend.</span>
      </template>
    </TopLeiste>
    <Kopf v-else titel="Gerät anlegen" zurueck />

    <!-- ══ Computer: Formular links, Rückmeldung rechts ═══════════════ -->
    <div v-if="breit" class="raster">
      <div class="pt-karte formular">
        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <div class="feld">
          <label class="pt-label" for="bez">Bezeichnung</label>
          <input
            id="bez"
            ref="bezeichnungEl"
            v-model="bezeichnung"
            class="pt-feld"
            type="text"
            placeholder="z. B. Rüttelplatte 600 kg"
            autocapitalize="sentences"
            @keyup.enter="speichern"
          />
          <p class="hinweis">Das Einzige, was gebraucht wird. Alles andere kann später kommen.</p>
        </div>

        <div class="paar">
          <div class="feld">
            <label class="pt-label" for="herst">Hersteller</label>
            <input id="herst" v-model="hersteller" class="pt-feld" type="text" />
          </div>
          <div class="feld">
            <label class="pt-label" for="mod">Modell</label>
            <input id="mod" v-model="modell" class="pt-feld" type="text" />
          </div>
        </div>

        <div class="paar">
          <div class="feld">
            <label class="pt-label" for="sn">Seriennummer</label>
            <input id="sn" v-model="seriennummer" class="pt-feld" type="text" />
          </div>
          <div class="feld">
            <label class="pt-label" for="inv">Inventarnummer</label>
            <input
              id="inv"
              v-model="inventarnummer"
              class="pt-feld pt-mono"
              type="text"
              inputmode="numeric"
              placeholder="wird vergeben"
            />
            <p class="hinweis">
              Leer lassen — der Server vergibt die nächste freie Nummer fortlaufend.
              Nur eintragen, wenn ein Etikett schon klebt.
            </p>
          </div>
        </div>

        <!--
          Das dritte Paar: Ort und Lagerplatz. Hat der Ort keine Regale, bleibt
          die rechte Hälfte leer — bewusst, siehe `plaetze`.

          Die Notiz stand früher rechts neben dem Ort, weil es den Lagerplatz
          noch nicht gab. Sie rutscht darunter über die volle Breite. Der
          Entwurf kennt sie beim Anlegen gar nicht; ersatzlos streichen darf man
          sie trotzdem nicht — sie ist das einzige Feld, in dem beim Erfassen
          steht, was sonst nirgends hinpasst („Schlüssel liegt im Büro“).
        -->
        <div class="paar">
          <div class="feld">
            <label class="pt-label" for="ort">Wo steht es?</label>
            <select id="ort" v-model="standortId" class="pt-feld">
              <option value="">— kein Standort —</option>
              <option v-for="s in bestand.aktiveStandorte" :key="s.id" :value="s.id">
                {{ s.name }}
              </option>
            </select>
          </div>
          <div v-if="plaetze.length" class="feld">
            <label class="pt-label" for="platz">Lagerplatz (falls bekannt)</label>
            <select id="platz" v-model="lagerplatzId" class="pt-feld">
              <option value="">— kein bestimmter Platz —</option>
              <option v-for="p in plaetze" :key="p.id" :value="p.id">
                {{ p.bezeichnung }}<template v-if="p.barcode"> ({{ p.barcode }})</template>
              </option>
            </select>
          </div>
        </div>

        <div class="feld">
          <label class="pt-label" for="notiz">Notiz</label>
          <input id="notiz" v-model="notiz" class="pt-feld" type="text" />
        </div>

        <div v-if="bestand.schlagworte.length" class="feld">
          <label class="pt-label">Schlagworte</label>
          <div class="worte">
            <button
              v-for="w in bestand.schlagworte"
              :key="w.id"
              class="wort"
              :class="{ 'wort--an': gewaehlteWorte.includes(w.id) }"
              :aria-pressed="gewaehlteWorte.includes(w.id)"
              @click="wortUmschalten(w.id)"
            >
              {{ w.name }}
            </button>
          </div>
        </div>

        <div class="knoepfe">
          <button
            class="pt-btn pt-btn--primaer tat"
            :disabled="speichert || !bezeichnung.trim()"
            @click="speichern"
          >
            {{ speichert ? "Wird angelegt …" : "Anlegen und nächstes" }}
          </button>
          <button
            class="pt-btn tat"
            :disabled="speichert || !bezeichnung.trim()"
            @click="speichernUndSchliessen"
          >
            Anlegen und schließen
          </button>
        </div>

        <p class="hinweis">
          Nach dem Speichern bleiben Ort, Lagerplatz und Schlagworte stehen — beim
          Erfassen einer Regalreihe ändern sie sich selten.
        </p>
      </div>

      <div class="seite">
        <section class="pt-karte">
          <div class="karte__kopf">
            <h2 class="karte__titel">In dieser Sitzung angelegt</h2>
            <span class="karte__anzahl">{{ angelegt.length }}</span>
          </div>

          <p v-if="!angelegt.length" class="leer">
            Was du anlegst, steht hier — mit Nummer, sobald der Server sie vergeben hat.
          </p>
          <ul v-else class="pt-liste">
            <li v-for="g in angelegt.slice(0, SICHTBAR)" :key="g.id">
              <button class="pt-zeile zeile" @click="router.push(`/geraete/${g.id}`)">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
                </div>
                <Symbol name="haken" :groesse="18" class="haken" />
              </button>
            </li>
            <!-- Sagen, dass es mehr gibt: eine abgeschnittene Liste ohne
                 Hinweis liest sich wie die vollständige. -->
            <li v-if="angelegt.length > SICHTBAR">
              <p class="pt-zeile pt-zeile--still zeile weitere">
                und {{ angelegt.length - SICHTBAR }} weitere in dieser Sitzung
              </p>
            </li>
          </ul>

          <div v-if="anmeldung.darf('etiketten.drucken')" class="karte__fuss">
            <button
              class="pt-btn pt-btn--breit fussknopf"
              :disabled="!angelegt.length"
              @click="zuEtiketten"
            >
              Etiketten für diese Geräte drucken
            </button>
          </div>
        </section>

        <section v-if="anmeldung.darf('daten.austauschen')" class="pt-karte excel">
          <h2 class="karte__titel">200 Geräte auf einmal?</h2>
          <p class="excel__text">
            Der Weg über die Tabelle ist schneller: Bestand exportieren, in Excel
            ergänzen, wieder einlesen. Leere Zelle heißt „nicht ändern“.
          </p>
          <button class="pt-btn pt-btn--breit fussknopf" @click="router.push('/austausch')">
            Zu Import und Export
          </button>
        </section>
      </div>
    </div>

    <!-- ══ Handy: eine Spalte, unverändert ════════════════════════════ -->
    <div v-else class="inhalt">
      <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <div class="feld">
        <label class="pt-label" for="bez">Bezeichnung</label>
        <input
          id="bez"
          ref="bezeichnungEl"
          v-model="bezeichnung"
          class="pt-feld"
          type="text"
          placeholder="z. B. Rüttelplatte 600 kg"
          autocapitalize="sentences"
          @keyup.enter="speichern"
        />
        <p class="hinweis">Das Einzige, was gebraucht wird. Alles andere kann später kommen.</p>
      </div>

      <div class="zwei">
        <div class="feld">
          <label class="pt-label" for="herst">Hersteller</label>
          <input id="herst" v-model="hersteller" class="pt-feld" type="text" />
        </div>
        <div class="feld">
          <label class="pt-label" for="mod">Modell</label>
          <input id="mod" v-model="modell" class="pt-feld" type="text" />
        </div>
      </div>

      <div class="feld">
        <label class="pt-label" for="ort">Wo steht es?</label>
        <select id="ort" v-model="standortId" class="pt-feld">
          <option value="">— kein Standort —</option>
          <option v-for="s in bestand.aktiveStandorte" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select>
      </div>

      <!--
        Der Platz steht hier offen und nicht hinter „Weitere Felder“: Wer am
        Handy erfasst, steht im Lager vor dem Regal und ist genau der, der ihn
        weiß. Hinter einem Aufklapper entstünden reihenweise Geräte ohne Regal,
        ohne dass es jemand bemerkt.
      -->
      <div v-if="plaetze.length" class="feld">
        <label class="pt-label" for="platz">Lagerplatz (falls bekannt)</label>
        <select id="platz" v-model="lagerplatzId" class="pt-feld">
          <option value="">— kein bestimmter Platz —</option>
          <option v-for="p in plaetze" :key="p.id" :value="p.id">
            {{ p.bezeichnung }}<template v-if="p.barcode"> ({{ p.barcode }})</template>
          </option>
        </select>
      </div>

      <div v-if="bestand.schlagworte.length" class="feld">
        <label class="pt-label">Schlagworte</label>
        <div class="worte">
          <button
            v-for="w in bestand.schlagworte"
            :key="w.id"
            class="wort"
            :class="{ 'wort--an': gewaehlteWorte.includes(w.id) }"
            :aria-pressed="gewaehlteWorte.includes(w.id)"
            @click="wortUmschalten(w.id)"
          >
            {{ w.name }}
          </button>
        </div>
      </div>

      <button class="pt-btn pt-btn--still mehr" @click="mehrFelder = !mehrFelder">
        {{ mehrFelder ? "Weniger Felder" : "Weitere Felder" }}
      </button>

      <template v-if="mehrFelder">
        <div class="feld">
          <label class="pt-label" for="sn">Seriennummer</label>
          <input id="sn" v-model="seriennummer" class="pt-feld" type="text" />
        </div>

        <div class="feld">
          <label class="pt-label" for="inv">Inventarnummer</label>
          <input
            id="inv"
            v-model="inventarnummer"
            class="pt-feld pt-mono"
            type="text"
            inputmode="numeric"
            placeholder="wird vergeben"
          />
          <p class="hinweis">
            Leer lassen — der Server vergibt die nächste freie Nummer fortlaufend.
            Nur eintragen, wenn ein Etikett schon klebt.
          </p>
        </div>

        <div class="feld">
          <label class="pt-label" for="notiz">Notiz</label>
          <input id="notiz" v-model="notiz" class="pt-feld" type="text" />
        </div>
      </template>

      <button
        class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
        :disabled="speichert || !bezeichnung.trim()"
        @click="speichern"
      >
        {{ speichert ? "Wird angelegt …" : "Anlegen und nächstes" }}
      </button>

      <!-- Rückmeldung beim Erfassen in Folge: was ist gerade entstanden? -->
      <section v-if="angelegt.length">
        <h2 class="pt-mikro abschnitt">
          In dieser Sitzung angelegt ({{ angelegt.length }})
        </h2>
        <ul class="pt-karte pt-liste">
          <li v-for="g in angelegt.slice(0, SICHTBAR)" :key="g.id">
            <button class="pt-zeile" @click="router.push(`/geraete/${g.id}`)">
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
              </div>
              <Symbol name="haken" :groesse="18" />
            </button>
          </li>
        </ul>
        <!--
          Ohne `etiketten.drucken` wirft der Router wortlos auf `/geraete`
          zurück — schlimmer als ein 403, weil der Benutzer gar keine Meldung
          sieht. Welches Recht `/etiketten` verlangt, steht in
          `rechte-pfade.ts`. Der Computer-Zweig prüft es im Kartenfuß; dieser
          Zweig musste es nachziehen.
        -->
        <button
          v-if="anmeldung.darf('etiketten.drucken')"
          class="pt-btn pt-btn--breit etiketten"
          @click="zuEtiketten"
        >
          Etiketten für diese Geräte drucken
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.anlegen {
  display: flex;
  flex-direction: column;
}

/* ── Handy ──────────────────────────────────────────────── */
.inhalt {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.mehr {
  align-self: flex-start;
  min-height: 40px;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.abschnitt {
  margin-bottom: var(--space-2);
}

.etiketten {
  margin-top: var(--space-3);
}

/* ── Beiden gemeinsam ───────────────────────────────────── */
.feld {
  display: flex;
  flex-direction: column;
}

.hinweis {
  margin-top: var(--space-2);
  font-size: var(--fs-13);
  line-height: var(--lh-normal);
  color: var(--fg-muted);
}

.worte {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.wort {
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  cursor: pointer;
}
.wort--an {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: var(--accent);
}

/* ── Computer ───────────────────────────────────────────── */
/*
 * 700 px für das Formular sind reichlich; breiter wird ein Eingabefeld
 * nicht besser lesbar. Deshalb keine volle Breite, sondern linksbündig
 * (`justify-content: start`) — der Rest der Fläche bleibt Luft.
 */
.raster {
  display: grid;
  grid-template-columns: minmax(0, 700px) 380px;
  justify-content: start;
  align-items: start;
  gap: var(--space-6);
  padding: var(--space-6);
}

/*
 * Am iPad quer bleiben neben der 240-px-Leiste rund 730 px übrig — zu
 * wenig für 700 + 380 nebeneinander. Dann stehen die beiden Spalten
 * untereinander, das Formular zuerst. Die Grenze ist dieselbe, an der
 * `useBreite` die Fingerbedienung endet.
 */
@media (max-width: 1279px) {
  .raster {
    grid-template-columns: minmax(0, 700px);
  }
}

.formular {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-6);
}

.paar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}

.knoepfe {
  display: flex;
  gap: var(--space-3);
}
.tat {
  min-height: 44px;
}

.nummernhinweis {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.seite {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

.karte__kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
}
.karte__titel {
  font-size: var(--fs-15);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.karte__anzahl {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
.karte__fuss {
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border);
}

.zeile {
  padding: var(--space-3) var(--space-5);
}
.leer {
  padding: var(--space-4) var(--space-5);
  font-size: var(--fs-14);
  line-height: var(--lh-normal);
  color: var(--fg-muted);
}
.weitere {
  font-size: var(--fs-13);
  color: var(--fg-subtle);
}
/* Der Haken bestätigt, dass es beim Server angekommen ist. */
.haken {
  flex: none;
  color: var(--success-fg);
}

.fussknopf {
  min-height: 40px;
}

.excel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
}
.excel__text {
  font-size: var(--fs-14);
  line-height: var(--lh-relaxed);
  color: var(--fg-body);
}

/* Mit der Maus muss man kein 48-px-Ziel treffen — die Pillen sind flacher. */
.anlegen--breit .wort {
  padding: 6px var(--space-3);
}

/*
 * Am iPad wird dieselbe Oberfläche mit dem Finger bedient: Knöpfe zurück
 * auf 44 px, Pillen zurück auf die Handy-Höhe.
 */
.anlegen--tablet .fussknopf {
  min-height: 44px;
}
.anlegen--tablet .wort {
  padding: var(--space-2) var(--space-3);
}
</style>
