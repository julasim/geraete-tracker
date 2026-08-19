<script setup lang="ts">
/**
 * Gerät anlegen.
 *
 * Auf Erfassen in Folge ausgelegt: Pflicht ist ausschließlich die
 * Bezeichnung, nach dem Speichern steht sofort ein leeres Formular bereit,
 * und die Auswahl von Standort und Schlagworten bleibt stehen. Wer 200
 * Maschinen erfasst, soll nicht 200 Mal dasselbe einstellen müssen.
 *
 * Die Nummer vergibt der Server (fortlaufend ab 10001) — von Hand eintragen
 * geht, ist aber ausdrücklich der Ausnahmefall.
 */
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useBestand } from "@/stores/bestand";
import type { Geraet } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import Symbol from "@/components/Symbol.vue";

const route = useRoute();
const router = useRouter();
const bestand = useBestand();

const bezeichnung = ref("");
const hersteller = ref("");
const modell = ref("");
const seriennummer = ref("");
const inventarnummer = ref((route.query.nummer as string) ?? "");
const notiz = ref("");
const standortId = ref("");
const gewaehlteWorte = ref<string[]>([]);
const mehrFelder = ref(false);

const speichert = ref(false);
const fehler = ref<string | null>(null);
/** Die zuletzt angelegten Geräte dieser Sitzung — Rückmeldung beim Erfassen in Folge. */
const angelegt = ref<Geraet[]>([]);

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

async function speichern(): Promise<void> {
  if (speichert.value || !bezeichnung.value.trim()) return;
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
      schlagworte: gewaehlteWorte.value,
    });

    bestand.ersetze(neu);
    angelegt.value.unshift(neu);

    // Für das nächste Gerät: nur die gerätespezifischen Felder leeren.
    // Standort und Schlagworte bleiben — beim Erfassen einer Regalreihe
    // ändern sie sich selten.
    bezeichnung.value = "";
    modell.value = "";
    seriennummer.value = "";
    inventarnummer.value = "";
    notiz.value = "";
    bezeichnungEl.value?.focus();
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht angelegt werden";
  } finally {
    speichert.value = false;
  }
}
</script>

<template>
  <div>
    <Kopf titel="Gerät anlegen" zurueck />

    <div class="inhalt">
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
          <li v-for="g in angelegt.slice(0, 10)" :key="g.id">
            <button class="pt-zeile" @click="router.push(`/geraete/${g.id}`)">
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
              </div>
              <Symbol name="haken" :groesse="18" />
            </button>
          </li>
        </ul>
        <button class="pt-btn pt-btn--breit etiketten" @click="router.push('/etiketten')">
          Etiketten für diese Geräte drucken
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.inhalt {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.feld {
  display: flex;
  flex-direction: column;
}

.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
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
</style>
