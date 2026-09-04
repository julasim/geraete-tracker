<script setup lang="ts">
/** Orte und ihr Bestand — beantwortet die Frage, was wo steht. */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { api, ApiError } from "@/api";
import { useBreite } from "@/composables/useBreite";
import { aehnlicherOrt as aehnlicherOrtVon } from "@/orte";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet, Lagerplatz, Standort } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";
import TopLeiste from "@/components/TopLeiste.vue";

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

/**
 * Den Bestand eines Ortes holen — einmal je Ort, danach aus dem Speicher.
 *
 * Bewusst OHNE eigenes catch: Der aufklappbare Weg am Handy behandelt einen
 * Fehlschlag seit jeher als „nichts da“, die zweispaltige Ansicht am
 * Computer zeigt eine Meldung. Wer den Fehler anzeigen will, fängt ihn an
 * seiner Aufrufstelle.
 */
async function ladeInhalt(id: string): Promise<void> {
  if (inhalt.value[id]) return;

  laedtOrt.value = id;
  try {
    const antwort = await api.get<{ geraete: Geraet[] }>(`/standorte/${id}/bestand`);
    inhalt.value[id] = antwort.geraete;
  } finally {
    laedtOrt.value = null;
  }
}

async function umschalten(id: string): Promise<void> {
  if (offen.value === id) {
    offen.value = null;
    return;
  }
  offen.value = id;
  await ladeInhalt(id);
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
 * Die Regel selbst steht seit AP25 in `orte.ts` — sie stand vorher dreimal
 * wortgleich da, hier und in beiden Buchungswegen.
 */
const aehnlicherOrt = computed(() => aehnlicherOrtVon(neuName.value, bestand.standorte));

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

/**
 * Einen Ort ändern oder stilllegen.
 *
 * Gelöscht wird nie: Der Name steht in jeder Buchung, die dorthin ging.
 * Ein stillgelegter Ort verschwindet aus den Auswahlfeldern, die Historie
 * bleibt lesbar. Die Fremdschlüssel stehen deshalb auf RESTRICT — ein
 * Löschversuch würde ohnehin abgewiesen.
 */
const bearbeitet = ref<string | null>(null);
const bearbName = ref("");
const bearbAdresse = ref("");
const bearbFehler = ref<string | null>(null);
const bearbLaeuft = ref(false);

function bearbeitenStarten(ort: Standort): void {
  bearbeitet.value = ort.id;
  bearbName.value = ort.name;
  bearbAdresse.value = ort.adresse ?? "";
  bearbFehler.value = null;
}

async function ortSpeichern(ort: Standort): Promise<void> {
  const name = bearbName.value.trim();
  if (bearbLaeuft.value || !name) return;
  bearbLaeuft.value = true;
  bearbFehler.value = null;
  try {
    const neu = await api.patch<Standort>(`/standorte/${ort.id}`, {
      name,
      adresse: bearbAdresse.value.trim() || null,
    });
    bestand.ergaenzeStandort(neu);
    bearbeitet.value = null;
  } catch (e) {
    bearbFehler.value =
      e instanceof ApiError ? e.message : "Die Änderung konnte nicht gespeichert werden.";
  } finally {
    bearbLaeuft.value = false;
  }
}

async function ortStilllegen(ort: Standort): Promise<void> {
  const anzahl = anzahlAmOrt(ort.id);
  const warnung =
    anzahl > 0
      ? `Hier stehen noch ${anzahl} Gerät(e). Sie bleiben eingetragen, aber der Ort ` +
        `lässt sich nicht mehr auswählen.

`
      : "";
  if (!confirm(`${warnung}„${ort.name}“ stilllegen?`)) return;
  bearbLaeuft.value = true;
  try {
    const neu = await api.patch<Standort>(`/standorte/${ort.id}`, { aktiv: false });
    bestand.ergaenzeStandort(neu);
    bearbeitet.value = null;
  } catch (e) {
    bearbFehler.value =
      e instanceof ApiError ? e.message : "Der Ort konnte nicht stillgelegt werden.";
  } finally {
    bearbLaeuft.value = false;
  }
}

/**
 * Regalplätze am aufgeklappten Ort anlegen.
 *
 * Ohne Barcode-Angabe vergibt der Server die nächste freie Kennung (P-0001).
 * Der getrennte Nummernkreis ist bis in die CHECK-Constraints durchgezogen —
 * hier wird deshalb nie eine Nummer von Hand gesetzt.
 */
const platzFuerOrt = ref<string | null>(null);
const platzName = ref("");
const platzLaeuft = ref(false);
const platzFehler = ref<string | null>(null);

async function platzAnlegen(ortId: string): Promise<void> {
  const bezeichnung = platzName.value.trim();
  if (platzLaeuft.value || !bezeichnung) return;
  platzLaeuft.value = true;
  platzFehler.value = null;
  try {
    const neu = await api.post<Lagerplatz>("/lagerplaetze", {
      standort_id: ortId,
      bezeichnung,
    });
    bestand.ergaenzeLagerplatz(neu);
    platzName.value = "";
  } catch (e) {
    platzFehler.value =
      e instanceof ApiError ? e.message : "Der Regalplatz konnte nicht angelegt werden.";
  } finally {
    platzLaeuft.value = false;
  }
}

/** Einen Regalplatz umbenennen. Die Kennung (P-0001) bleibt unberührt — sie
 *  klebt als Etikett am Regal. */
const platzBearbeitet = ref<string | null>(null);
const platzNeuName = ref("");

async function platzSpeichern(platz: Lagerplatz): Promise<void> {
  const bezeichnung = platzNeuName.value.trim();
  if (platzLaeuft.value || !bezeichnung) return;
  platzLaeuft.value = true;
  platzFehler.value = null;
  try {
    const neu = await api.patch<Lagerplatz>(`/lagerplaetze/${platz.id}`, { bezeichnung });
    bestand.ergaenzeLagerplatz(neu);
    platzBearbeitet.value = null;
  } catch (e) {
    platzFehler.value =
      e instanceof ApiError ? e.message : "Die Änderung konnte nicht gespeichert werden.";
  } finally {
    platzLaeuft.value = false;
  }
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

/* ══ Ab hier die Computer-Haltung ═════════════════════════════════════════
 *
 * Am Handy klappt ein Ort auf: Auf 390 px ist für zwei Spalten kein Platz,
 * und man arbeitet ohnehin an genau einem Ort. Am Schreibtisch wird
 * verglichen — links alle Orte, rechts einer davon vollständig.
 *
 * Es bleibt EINE Ansicht mit denselben Daten, denselben Aufrufen und
 * denselben Regeln; nur die Anordnung wechselt. Ein zweites Bauteil wären
 * zwei Stellen, an denen steht, dass ein Ort stillgelegt und nie gelöscht
 * wird — und irgendwann zwei verschiedene Antworten darauf.
 */
const { breit, tablet } = useBreite();

/**
 * Die Gruppen der linken Spalte.
 *
 * Die Reihenfolge bildet die Sortierung von `orte` ab (Lager, Werkstatt,
 * dann der Rest alphabetisch), nur mit Überschriften dazwischen. `extern`
 * bekommt eine eigene: Ein fremder Bauhof unter „Baustellen“ wäre schlicht
 * falsch. Die Gruppe erscheint nur, wenn es solche Orte überhaupt gibt.
 */
const GRUPPEN: { titel: string; typen: Standort["typ"][] }[] = [
  { titel: "Lager und Werkstatt", typen: ["lager", "werkstatt"] },
  { titel: "Baustellen", typen: ["baustelle"] },
  { titel: "Extern", typen: ["extern"] },
];

const gruppen = computed(() =>
  GRUPPEN.map((g) => ({
    titel: g.titel,
    // Die Art gehört nur dorthin, wo mehrere in einer Gruppe stehen. Unter
    // „Baustellen“ wäre „Baustelle“ eine Zeile, die nichts sagt.
    mitTyp: g.typen.length > 1,
    orte: orte.value.filter((o) => g.typen.includes(o.typ)),
  })).filter((g) => g.orte.length),
);

function untertitel(ort: Standort, mitTyp: boolean): string {
  return [mitTyp ? TYP_TEXT[ort.typ] : null, ort.adresse].filter(Boolean).join(" · ");
}

const anzahlWort = (n: number, eins: string, viele: string) => `${n} ${n === 1 ? eins : viele}`;

const gewaehlt = ref<string | null>(null);
const bestandFehler = ref<string | null>(null);

const gewaehlterOrt = computed(() => orte.value.find((o) => o.id === gewaehlt.value) ?? null);
const plaetzeAmOrt = computed(() =>
  gewaehlterOrt.value ? bestand.plaetzeAmStandort(gewaehlterOrt.value.id) : [],
);
const bestandAmOrt = computed(() =>
  gewaehlterOrt.value ? (inhalt.value[gewaehlterOrt.value.id] ?? []) : [],
);

const anzahlAmPlatz = (id: string) =>
  bestand.geraete.filter((g) => g.aktueller_lagerplatz_id === id).length;

/**
 * „P-0001 · 34 Geräte“.
 *
 * Die Kennung kommt aus dem Datensatz. Sie hier zu erzeugen oder
 * fortzuzählen wäre der Anfang doppelter Etiketten — der Nummernkreis der
 * Regalplätze gehört dem Server, und er ist von dem der Geräte getrennt.
 * Ohne Kennung steht nur die Anzahl da, nie ein geratenes „P-…“.
 */
function platzZeile(platz: Lagerplatz): string {
  return [platz.barcode, anzahlWort(anzahlAmPlatz(platz.id), "Gerät", "Geräte")]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Die Zeile unter dem Namen: Adresse · Geräte · Regalplätze.
 *
 * Die Gerätezahl stammt aus der geladenen Liste, nicht aus dem Bestand im
 * Speicher: Der Server lässt ausgemusterte Geräte weg. Sonst stünde im Kopf
 * eine Zahl, die sich in der Liste darunter nicht nachzählen lässt. Solange
 * geladen wird, steht die Zahl aus dem Speicher da — sie ist näher dran als
 * eine 0.
 */
const kopfZeile = computed(() => {
  const ort = gewaehlterOrt.value;
  if (!ort) return "";
  const geladen = inhalt.value[ort.id];
  return [
    ort.adresse,
    anzahlWort(geladen ? geladen.length : anzahlAmOrt(ort.id), "Gerät", "Geräte"),
    anzahlWort(plaetzeAmOrt.value.length, "Regalplatz", "Regalplätze"),
  ]
    .filter(Boolean)
    .join(" · ");
});

async function waehle(id: string): Promise<void> {
  gewaehlt.value = id;
  // Das Anlegeformular belegt dieselbe Fläche wie die Ortsakte. Wer in der
  // Liste klickt, will die Akte sehen — die Eingaben bleiben aber stehen,
  // damit ein Fehlgriff keinen halb getippten Namen wegwirft.
  formularOffen.value = false;
  bearbeitet.value = null;
  platzFuerOrt.value = null;
  platzBearbeitet.value = null;
  bestandFehler.value = null;
  try {
    await ladeInhalt(id);
  } catch (e) {
    bestandFehler.value =
      e instanceof ApiError ? e.message : "Der Bestand konnte nicht geladen werden.";
  }
}

/**
 * Es ist immer ein Ort ausgewählt — eine leere rechte Hälfte hilft niemandem.
 *
 * Greift auch nach dem Stilllegen: Der Ort fällt aus `orte` heraus, die
 * Auswahl rückt auf den nächsten. Nur in der breiten Haltung, sonst holte
 * das Handy beim Öffnen einen Bestand, den dort niemand zu sehen bekommt.
 */
watch(
  [orte, breit],
  ([liste, istBreit]) => {
    if (!istBreit) return;
    if (gewaehlt.value && liste.some((o) => o.id === gewaehlt.value)) return;
    if (liste[0]) void waehle(liste[0].id);
    else gewaehlt.value = null;
  },
  { immediate: true },
);

async function formularUmschalten(): Promise<void> {
  if (formularOffen.value) {
    formularOffen.value = false;
    return;
  }
  await formularZeigen();
}

function platzFormZeigen(ortId: string): void {
  platzFuerOrt.value = ortId;
  platzFehler.value = null;
}

function platzUmbenennenStarten(platz: Lagerplatz): void {
  platzBearbeitet.value = platz.id;
  platzNeuName.value = platz.bezeichnung;
  platzFehler.value = null;
}

onMounted(() => void bestand.laden());
</script>

<template>
  <!-- ══ Computer und iPad: links alle Orte, rechts einer vollständig ══ -->
  <div v-if="breit" class="ort-flaeche" :class="{ 'ort-flaeche--tablet': tablet }">
    <TopLeiste titel="Orte und Regale" :unter="`${orte.length} aktiv`">
      <template #rechts>
        <button v-if="darfPflegen" class="pt-btn pt-btn--primaer" @click="formularUmschalten">
          <Symbol name="plus" :groesse="16" /> Neue Baustelle
        </button>
      </template>
    </TopLeiste>

    <div class="ort-spalten">
      <div class="ort-liste">
        <p v-if="!orte.length" class="pt-leer">Noch keine Orte erfasst.</p>

        <template v-for="g in gruppen" :key="g.titel">
          <div class="ort-gruppe">{{ g.titel }}</div>
          <ul class="pt-liste">
            <li v-for="o in g.orte" :key="o.id">
              <button
                class="pt-zeile ort-zeile"
                :class="{ 'ort-zeile--gewaehlt': gewaehlt === o.id }"
                :aria-current="gewaehlt === o.id ? 'true' : undefined"
                @click="waehle(o.id)"
              >
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ o.name }}</div>
                  <div class="pt-zeile__unter">{{ untertitel(o, g.mitTyp) }}</div>
                </div>
                <span class="pt-chip pt-chip--neutral">{{ anzahlAmOrt(o.id) }}</span>
              </button>
            </li>
          </ul>
        </template>
      </div>

      <div class="ort-detail">
        <!-- Anlegen belegt die rechte Hälfte: Dort ist Platz für zwei Spalten,
             und die Liste links zeigt nebenher, was gerade entsteht. -->
        <form v-if="formularOffen" class="pt-karte ort-form" @submit.prevent="ortAnlegen">
          <div class="ort-feldgruppe">
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

          <div class="ort-formzeile">
            <div class="ort-feldgruppe">
              <label class="pt-label" for="neu-typ">Art</label>
              <select id="neu-typ" v-model="neuTyp" class="pt-feld">
                <option value="baustelle">Baustelle</option>
                <option value="lager">Lager</option>
                <option value="werkstatt">Werkstatt</option>
                <option value="extern">Extern</option>
              </select>
            </div>

            <div class="ort-feldgruppe">
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

          <div class="ort-knopfzeile">
            <button type="button" class="pt-btn pt-btn--still" @click="formularSchliessen">
              Fertig
            </button>
            <button
              type="submit"
              class="pt-btn pt-btn--primaer"
              :disabled="speichert || !neuName.trim()"
            >
              {{ speichert ? "Wird angelegt …" : "Anlegen" }}
            </button>
          </div>
        </form>

        <template v-else-if="gewaehlterOrt">
          <!-- ── Kopf: welcher Ort, was steht da, was lässt sich tun ── -->
          <div v-if="bearbeitet === gewaehlterOrt.id" class="pt-karte ort-form">
            <div class="ort-formzeile">
              <div class="ort-feldgruppe">
                <label class="pt-label" for="bearb-name">Name</label>
                <input id="bearb-name" v-model="bearbName" class="pt-feld" maxlength="120" />
              </div>
              <div class="ort-feldgruppe">
                <label class="pt-label" for="bearb-adresse">Adresse</label>
                <input id="bearb-adresse" v-model="bearbAdresse" class="pt-feld" maxlength="300" />
              </div>
            </div>

            <p v-if="bearbFehler" class="pt-meldung pt-meldung--fehler">{{ bearbFehler }}</p>

            <div class="ort-knopfzeile">
              <button class="pt-btn pt-btn--still" @click="bearbeitet = null">Abbrechen</button>
              <!-- Stilllegen statt Löschen, und als stiller Knopf: Der Schutz
                   ist die Rückfrage, nicht eine rote Fläche. -->
              <button
                class="pt-btn pt-btn--still"
                :disabled="bearbLaeuft"
                @click="ortStilllegen(gewaehlterOrt)"
              >
                Stilllegen
              </button>
              <button
                class="pt-btn pt-btn--primaer"
                :disabled="bearbLaeuft || !bearbName.trim()"
                @click="ortSpeichern(gewaehlterOrt)"
              >
                Speichern
              </button>
            </div>
          </div>

          <div v-else class="ort-kopf">
            <div>
              <p class="pt-mikro">{{ TYP_TEXT[gewaehlterOrt.typ] }}</p>
              <h2 class="ort-kopf__name">{{ gewaehlterOrt.name }}</h2>
              <p class="ort-kopf__zeile">{{ kopfZeile }}</p>
            </div>

            <div v-if="darfPflegen" class="ort-kopf__knoepfe">
              <button class="pt-btn" @click="bearbeitenStarten(gewaehlterOrt)">
                Ort bearbeiten
              </button>
              <button class="pt-btn" @click="platzFormZeigen(gewaehlterOrt.id)">
                <Symbol name="plus" :groesse="16" /> Regalplatz
              </button>
            </div>
          </div>

          <!-- ── Regalplätze ──────────────────────────────────────── -->
          <section class="pt-karte">
            <div class="ort-karte__kopf">
              <h3 class="ort-karte__titel">Regalplätze</h3>
              <span class="ort-karte__zusatz">Die Kennung vergibt das System</span>
            </div>

            <div v-if="platzFuerOrt === gewaehlterOrt.id" class="ort-platzform">
              <div class="ort-feldgruppe">
                <label class="pt-label" for="platz-name">Bezeichnung</label>
                <input
                  id="platz-name"
                  v-model="platzName"
                  class="pt-feld"
                  maxlength="120"
                  placeholder="z. B. Regal C3"
                  @keyup.enter="platzAnlegen(gewaehlterOrt.id)"
                />
              </div>
              <div class="ort-knopfzeile">
                <button class="pt-btn pt-btn--still" @click="platzFuerOrt = null">Fertig</button>
                <button
                  class="pt-btn pt-btn--primaer"
                  :disabled="platzLaeuft || !platzName.trim()"
                  @click="platzAnlegen(gewaehlterOrt.id)"
                >
                  {{ platzLaeuft ? "Wird angelegt …" : "Anlegen" }}
                </button>
              </div>
            </div>

            <p v-if="platzFehler" class="pt-meldung pt-meldung--fehler ort-meldung">
              {{ platzFehler }}
            </p>

            <p v-if="!plaetzeAmOrt.length" class="pt-leer">Noch keine Regalplätze.</p>
            <div v-else class="ort-plaetze">
              <div v-for="p in plaetzeAmOrt" :key="p.id" class="ort-platz">
                <div v-if="platzBearbeitet === p.id" class="ort-platz__form">
                  <input v-model="platzNeuName" class="pt-feld" maxlength="120" />
                  <div class="ort-knopfzeile">
                    <button class="pt-btn pt-btn--still" @click="platzBearbeitet = null">
                      Abbrechen
                    </button>
                    <button
                      class="pt-btn pt-btn--primaer"
                      :disabled="platzLaeuft || !platzNeuName.trim()"
                      @click="platzSpeichern(p)"
                    >
                      Speichern
                    </button>
                  </div>
                </div>

                <template v-else>
                  <div class="ort-platz__text">
                    <div class="ort-platz__name">{{ p.bezeichnung }}</div>
                    <div class="pt-mono ort-platz__kennung">{{ platzZeile(p) }}</div>
                  </div>
                  <button
                    v-if="darfPflegen"
                    class="pt-btn pt-btn--still ort-platz__stift"
                    :aria-label="`${p.bezeichnung} umbenennen`"
                    @click="platzUmbenennenStarten(p)"
                  >
                    <Symbol name="stift" :groesse="16" />
                  </button>
                </template>
              </div>
            </div>
          </section>

          <!-- ── Bestand am Ort ───────────────────────────────────── -->
          <section class="pt-karte ort-bestand">
            <div class="ort-karte__kopf">
              <h3 class="ort-karte__titel">Bestand am Ort</h3>
              <span v-if="laedtOrt !== gewaehlterOrt.id" class="ort-karte__zusatz">
                {{ anzahlWort(bestandAmOrt.length, "Gerät", "Geräte") }}
              </span>
            </div>

            <p v-if="bestandFehler" class="pt-meldung pt-meldung--fehler ort-meldung">
              {{ bestandFehler }}
            </p>
            <p v-else-if="laedtOrt === gewaehlterOrt.id" class="pt-leer">Wird geladen …</p>
            <p v-else-if="!bestandAmOrt.length" class="pt-leer">Hier steht derzeit nichts.</p>
            <ul v-else class="pt-liste ort-bestandliste">
              <li v-for="g in bestandAmOrt" :key="g.id">
                <RouterLink :to="`/geraete/${g.id}`" class="pt-zeile ort-bestandzeile">
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
          </section>
        </template>
      </div>
    </div>
  </div>

  <!-- ══ Handy: eine Spalte, ein Ort klappt auf ═══════════════════════ -->
  <div v-else>
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
          <!-- Verwalten: nur mit Recht, und nur am aufgeklappten Ort. -->
          <div v-if="darfPflegen" class="verwalten">
            <template v-if="bearbeitet === o.id">
              <div class="feldgruppe">
                <label class="pt-label" :for="`n-${o.id}`">Name</label>
                <input :id="`n-${o.id}`" v-model="bearbName" class="pt-feld" maxlength="120" />
              </div>
              <div class="feldgruppe">
                <label class="pt-label" :for="`a-${o.id}`">Adresse</label>
                <input :id="`a-${o.id}`" v-model="bearbAdresse" class="pt-feld" maxlength="300" />
              </div>
              <p v-if="bearbFehler" class="pt-meldung pt-meldung--fehler">{{ bearbFehler }}</p>
              <div class="knopfzeile">
                <button class="pt-btn pt-btn--still" @click="bearbeitet = null">Abbrechen</button>
                <button class="pt-btn" :disabled="bearbLaeuft" @click="ortStilllegen(o)">
                  Stilllegen
                </button>
                <button
                  class="pt-btn pt-btn--primaer"
                  :disabled="bearbLaeuft || !bearbName.trim()"
                  @click="ortSpeichern(o)"
                >
                  Speichern
                </button>
              </div>
            </template>

            <template v-else>
              <button class="pt-btn pt-btn--still" @click="bearbeitenStarten(o)">
                Ort bearbeiten
              </button>
              <button
                v-if="platzFuerOrt !== o.id"
                class="pt-btn pt-btn--still"
                @click="((platzFuerOrt = o.id), (platzFehler = null))"
              >
                <Symbol name="plus" :groesse="16" /> Regalplatz
              </button>

              <div v-else class="platz">
                <div class="feldgruppe">
                  <label class="pt-label" :for="`p-${o.id}`">
                    Neuer Regalplatz — die Kennung vergibt das System
                  </label>
                  <input
                    :id="`p-${o.id}`"
                    v-model="platzName"
                    class="pt-feld"
                    maxlength="120"
                    placeholder="z. B. Regal C3"
                    @keyup.enter="platzAnlegen(o.id)"
                  />
                </div>
                <p v-if="platzFehler" class="pt-meldung pt-meldung--fehler">{{ platzFehler }}</p>
                <div class="knopfzeile">
                  <button class="pt-btn pt-btn--still" @click="platzFuerOrt = null">Fertig</button>
                  <button
                    class="pt-btn pt-btn--primaer"
                    :disabled="platzLaeuft || !platzName.trim()"
                    @click="platzAnlegen(o.id)"
                  >
                    {{ platzLaeuft ? "Wird angelegt …" : "Anlegen" }}
                  </button>
                </div>
              </div>
            </template>
          </div>

          <ul v-if="bestand.plaetzeAmStandort(o.id).length" class="plaetze">
            <li v-for="p in bestand.plaetzeAmStandort(o.id)" :key="p.id" class="platz__zeile">
              <template v-if="platzBearbeitet === p.id">
                <input v-model="platzNeuName" class="pt-feld" maxlength="120" />
                <button class="pt-btn pt-btn--still" @click="platzBearbeitet = null">
                  Abbrechen
                </button>
                <button
                  class="pt-btn pt-btn--primaer"
                  :disabled="platzLaeuft || !platzNeuName.trim()"
                  @click="platzSpeichern(p)"
                >
                  Speichern
                </button>
              </template>
              <template v-else>
                <span class="platz__name">{{ p.bezeichnung }}</span>
                <span v-if="p.barcode" class="pt-mono pt-gedaempft">{{ p.barcode }}</span>
                <button
                  v-if="darfPflegen"
                  class="pt-btn pt-btn--still kleinknopf"
                  @click="((platzBearbeitet = p.id), (platzNeuName = p.bezeichnung))"
                >
                  Umbenennen
                </button>
              </template>
            </li>
          </ul>

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
/* ══ Handy ════════════════════════════════════════════════════════════ */
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
.verwalten {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4) var(--space-3) 0;
  border-bottom: 1px solid var(--hairline);
}
.verwalten .feldgruppe,
.verwalten .platz {
  flex: 1 1 100%;
}
.platz {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.plaetze {
  list-style: none;
  margin: 0;
  padding: var(--space-2) 0 var(--space-2) var(--space-2);
}
.platz__zeile {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-1) 0;
  font-size: var(--fs-13);
}
.platz__name {
  flex: 1;
  min-width: 0;
}
.kleinknopf {
  font-size: var(--fs-12);
  padding: var(--space-1) var(--space-2);
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

/* ══ Computer und iPad ════════════════════════════════════════════════
 *
 * Alle Klassen tragen das Präfix `ort-`. Das ist kein Ordnungssinn,
 * sondern Vorsicht: Vue vergibt das scoped-Attribut der ELTERN-Komponente
 * auch an das Wurzelelement des Kindes. Eine Regel `.liste` oder `.kopf`
 * griffe damit in fremde Bauteile durch — in diesem Projekt schon einmal
 * passiert, siehe die Warnung in SeitenLeiste.vue.
 */
.ort-flaeche {
  display: flex;
  flex-direction: column;
}

/*
 * Die beiden Spalten scrollen getrennt, die Seite selbst gar nicht — sonst
 * wanderte die Kopfzeile beim Blättern durch 118 Geräte mit nach oben aus
 * dem Bild. Die Höhe der Kopfzeile steht als --topleiste-hoehe in
 * tokens.css — nicht als feste 56, sonst laufen Kopfzeile und Resthöhe
 * beim nächsten Ändern auseinander.
 */
.ort-spalten {
  display: flex;
  height: calc(100dvh - var(--topleiste-hoehe));
  min-height: 0;
}

.ort-liste {
  width: 340px;
  flex: none;
  overflow-y: auto;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.ort-gruppe {
  padding: var(--space-3) var(--space-4);
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--fg-subtle);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
/* Die erste Überschrift stößt an die Kopfzeile — zwei Linien übereinander
   wären eine zu viel. */
.ort-gruppe:first-child {
  border-top: 0;
}

.ort-zeile {
  padding: var(--space-3) var(--space-4);
}
/* Die gewählte Zeile bleibt markiert, auch unter dem Zeiger: Sonst verlöre
   man beim Hinüberfahren die Spur, welcher Ort rechts steht. */
.ort-zeile--gewaehlt,
.ort-zeile--gewaehlt:hover {
  background: var(--surface-muted);
}

.ort-detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.ort-kopf {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.ort-kopf__name {
  margin-top: var(--space-1);
  font-size: var(--fs-24);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
}
.ort-kopf__zeile {
  margin-top: var(--space-1);
  font-size: var(--fs-14);
  color: var(--fg-muted);
}
.ort-kopf__knoepfe {
  display: flex;
  gap: var(--space-2);
  flex: none;
}
/* Aktionen neben dem Namen sind kleiner als im Inhalt: 36 px statt 48. */
.ort-kopf__knoepfe .pt-btn {
  min-height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--fs-13);
}
/* Mit dem Finger sind 36 px zu klein — am iPad zurück auf 44. */
.ort-flaeche--tablet .ort-kopf__knoepfe .pt-btn {
  min-height: 44px;
}

.ort-karte__kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
}
.ort-karte__titel {
  font-size: var(--fs-15);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.ort-karte__zusatz {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.ort-plaetze {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
.ort-platz {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  border-right: 1px solid var(--hairline);
}
/* Kein Strich am rechten Rand der Karte, und ab der zweiten Reihe einer nach
   oben — sonst schwebten die Felder ohne Raster. */
.ort-platz:nth-child(3n) {
  border-right: 0;
}
.ort-platz:nth-child(n + 4) {
  border-top: 1px solid var(--hairline);
}
.ort-platz__text {
  flex: 1;
  min-width: 0;
}
.ort-platz__form {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.ort-platz__name {
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.ort-platz__kennung {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.ort-platz__stift {
  min-height: 32px;
  width: 32px;
  padding: 0;
  flex: none;
}
.ort-flaeche--tablet .ort-platz__stift {
  min-height: 44px;
  width: 44px;
}

/* Der Bestand nimmt den Rest der Höhe und scrollt in sich. */
.ort-bestand {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.ort-bestandliste {
  overflow-y: auto;
}
.ort-bestandzeile {
  padding: var(--space-3) var(--space-5);
}

.ort-form {
  padding: var(--space-6);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.ort-formzeile {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.ort-feldgruppe {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.ort-knopfzeile {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
.ort-platzform {
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.ort-meldung {
  margin: var(--space-4) var(--space-5);
}
</style>
