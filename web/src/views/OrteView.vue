<script setup lang="ts">
/** Orte und ihr Bestand — beantwortet die Frage, was wo steht. */
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Standort } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";

const bestand = useBestand();
const anmeldung = useAnmeldung();
const offen = ref<string | null>(null);
const inhalt = ref<Record<string, Geraet[]>>({});
const laedtOrt = ref<string | null>(null);

const orte = computed(() =>
  [...bestand.aktiveStandorte].sort((a, b) => {
    // Lager zuerst, dann Werkstatt, dann Baustellen — so sucht man auch im Kopf.
    const rang = (s: Standort) => (s.typ === "lager" ? 0 : s.typ === "werkstatt" ? 1 : 2);
    return rang(a) - rang(b) || a.name.localeCompare(b.name, "de");
  }),
);

const anzahlAmOrt = (id: string) =>
  bestand.geraete.filter((g) => g.aktueller_standort_id === id).length;

async function umschalten(id: string): Promise<void> {
  if (offen.value === id) {
    offen.value = null;
    return;
  }
  offen.value = id;
  if (inhalt.value[id]) return;

  laedtOrt.value = id;
  try {
    const antwort = await api.get<{ geraete: Geraet[] }>(`/standorte/${id}/bestand`);
    inhalt.value[id] = antwort.geraete;
  } finally {
    laedtOrt.value = null;
  }
}

const TYP_TEXT: Record<string, string> = {
  lager: "Lager",
  baustelle: "Baustelle",
  werkstatt: "Werkstatt",
  extern: "Extern",
};

/**
 * Einen Ort anlegen.
 *
 * Das war bis hierher nur über die API möglich — die Routen gab es seit AP4,
 * nur rief sie niemand auf. Eine neue Baustelle ist aber Alltag: Sobald ein
 * Auftrag hereinkommt, muss man Geräte dorthin buchen können, ohne auf die
 * Kommandozeile auszuweichen.
 */
const darfPflegen = computed(() => anmeldung.darf("stammdaten.pflegen"));

const formularOffen = ref(false);
const neuName = ref("");
const neuTyp = ref<Standort["typ"]>("baustelle");
const neuAdresse = ref("");
const speichert = ref(false);
const anlageFehler = ref<string | null>(null);
const zuletztAngelegt = ref<string | null>(null);
const nameEl = ref<HTMLInputElement | null>(null);

/**
 * Trifft der eingetippte Name einen Ort, den es schon gibt?
 *
 * Der Hinweis erscheint, BEVOR gespeichert wird. Sonst entstehen mit der Zeit
 * "Lindengasse", "Lindengasse 14" und "lindengasse" nebeneinander, und der
 * Bestand verteilt sich auf drei Orte, die dasselbe meinen. Die Datenbank
 * verhindert nur exakte Dubletten unter den aktiven Orten.
 */
const aehnlicherOrt = computed(() => {
  const eingabe = neuName.value.trim().toLowerCase();
  if (eingabe.length < 3) return null;
  return (
    bestand.standorte.find((s) => {
      const name = s.name.toLowerCase();
      return name === eingabe || name.includes(eingabe) || eingabe.includes(name);
    }) ?? null
  );
});

async function formularZeigen(): Promise<void> {
  formularOffen.value = true;
  anlageFehler.value = null;
  await nextTick();
  nameEl.value?.focus();
}

function formularSchliessen(): void {
  formularOffen.value = false;
  neuName.value = "";
  neuAdresse.value = "";
  anlageFehler.value = null;
}

async function ortAnlegen(): Promise<void> {
  const name = neuName.value.trim();
  if (speichert.value || !name) return;
  speichert.value = true;
  anlageFehler.value = null;

  try {
    const neu = await api.post<Standort>("/standorte", {
      name,
      typ: neuTyp.value,
      // Leeres Feld heißt "nichts angegeben", nicht "leerer Text".
      adresse: neuAdresse.value.trim() || null,
    });

    // Sofort im Store: Ab jetzt steht der Ort in jedem Auswahlfeld, ohne
    // dass irgendwo neu geladen werden muss.
    bestand.ergaenzeStandort(neu);
    zuletztAngelegt.value = neu.name;

    // Nächster Ort ohne Umweg — beim Ersteinrichten legt man mehrere am Stück
    // an. Der Typ bleibt stehen, der Name wird geleert.
    neuName.value = "";
    neuAdresse.value = "";
    await nextTick();
    nameEl.value?.focus();
  } catch (e) {
    anlageFehler.value =
      e instanceof ApiError
        ? e.message
        : "Der Ort konnte nicht angelegt werden. Bitte noch einmal versuchen.";
  } finally {
    speichert.value = false;
  }
}

onMounted(() => void bestand.laden());
</script>

<template>
  <div>
    <Kopf titel="Orte" :unter="`${orte.length} aktiv`" />

    <div v-if="darfPflegen" class="anlage">
      <button v-if="!formularOffen" class="pt-btn pt-btn--breit" @click="formularZeigen">
        <Symbol name="plus" /> Neue Baustelle anlegen
      </button>

      <form v-else class="formular" @submit.prevent="ortAnlegen">
        <div class="feldgruppe">
          <label class="pt-label" for="neu-name">Name der Baustelle</label>
          <input
            id="neu-name"
            ref="nameEl"
            v-model="neuName"
            class="pt-feld"
            maxlength="120"
            placeholder="z. B. Lindengasse 14"
            autocomplete="off"
          />
        </div>

        <p v-if="aehnlicherOrt" class="pt-meldung pt-meldung--warnung">
          Es gibt bereits „{{ aehnlicherOrt.name }}“. Ist das derselbe Ort?
        </p>

        <div class="zeile-zwei">
          <div class="feldgruppe">
            <label class="pt-label" for="neu-typ">Art</label>
            <select id="neu-typ" v-model="neuTyp" class="pt-feld">
              <option value="baustelle">Baustelle</option>
              <option value="lager">Lager</option>
              <option value="werkstatt">Werkstatt</option>
              <option value="extern">Extern</option>
            </select>
          </div>

          <div class="feldgruppe">
            <label class="pt-label" for="neu-adresse">Adresse (optional)</label>
            <input
              id="neu-adresse"
              v-model="neuAdresse"
              class="pt-feld"
              maxlength="300"
              autocomplete="off"
            />
          </div>
        </div>

        <p v-if="anlageFehler" class="pt-meldung pt-meldung--fehler">{{ anlageFehler }}</p>
        <p v-else-if="zuletztAngelegt" class="pt-meldung pt-meldung--erfolg">
          „{{ zuletztAngelegt }}“ ist angelegt und steht ab sofort zur Auswahl.
        </p>

        <div class="knopfzeile">
          <button type="button" class="pt-btn pt-btn--still" @click="formularSchliessen">
            Fertig
          </button>
          <button type="submit" class="pt-btn pt-btn--primaer" :disabled="speichert || !neuName.trim()">
            {{ speichert ? "Wird angelegt …" : "Anlegen" }}
          </button>
        </div>
      </form>
    </div>

    <p v-if="!orte.length" class="pt-leer">Noch keine Orte erfasst.</p>

    <ul v-else class="pt-liste liste">
      <li v-for="o in orte" :key="o.id">
        <button class="pt-zeile" :aria-expanded="offen === o.id" @click="umschalten(o.id)">
          <div class="pt-zeile__haupt">
            <div class="pt-zeile__titel">{{ o.name }}</div>
            <div class="pt-zeile__unter">
              {{ TYP_TEXT[o.typ] }}<template v-if="o.adresse"> · {{ o.adresse }}</template>
            </div>
          </div>
          <span class="pt-chip pt-chip--neutral">{{ anzahlAmOrt(o.id) }}</span>
        </button>

        <div v-if="offen === o.id" class="aufklappen">
          <p v-if="laedtOrt === o.id" class="pt-leer">Wird geladen …</p>
          <p v-else-if="!inhalt[o.id]?.length" class="pt-leer">Hier steht derzeit nichts.</p>
          <ul v-else class="pt-liste">
            <li v-for="g in inhalt[o.id]" :key="g.id">
              <RouterLink :to="`/geraete/${g.id}`" class="pt-zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">
                    {{ g.inventarnummer
                    }}<template v-if="g.lagerplatz"> · {{ g.lagerplatz }}</template>
                  </div>
                </div>
                <StatusChip :status="g.status" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.anlage {
  padding: var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.formular {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.feldgruppe {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
/* Auf dem Handy untereinander, ab Tablet nebeneinander. */
.zeile-zwei {
  display: grid;
  gap: var(--space-3);
}
@media (min-width: 560px) {
  .zeile-zwei {
    grid-template-columns: 1fr 1fr;
  }
}
.knopfzeile {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
.liste {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.aufklappen {
  background: var(--surface-subtle);
  border-top: 1px solid var(--hairline);
  padding-left: var(--space-4);
}
</style>
