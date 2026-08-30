<script setup lang="ts">
/**
 * Ausgeben, Zurücknehmen, Umbuchen — in zwei Tippern.
 *
 * Standort und Person sind vorbelegt (zuletzt gewählt), aber änderbar.
 * Serienausgabe ist der Normalfall beim Bestücken eines Transporters,
 * deshalb führt die Bestätigung direkt zurück zum Scanner.
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import { useFoto } from "@/composables/useFoto";
import type { Buchungsart, Geraet, Standort } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";

const route = useRoute();
const router = useRouter();
const bestand = useBestand();
const anmeldung = useAnmeldung();

const geraetId = route.params.id as string;
const art = route.params.art as Buchungsart;

const geraet = ref<Geraet | null>(null);
/** Nur das Nötigste: die Liste kommt ohne Verwaltungsrecht abgespeckt. */
const personen = ref<{ id: string; anzeigename: string }[]>([]);
const laedt = ref(true);
const speichert = ref(false);
const fehler = ref<string | null>(null);
const fertig = ref(false);

const standortId = ref("");
const lagerplatzId = ref("");

/**
 * Eine Baustelle anlegen, ohne den Buchungsvorgang zu verlassen.
 *
 * Der Fall aus der Praxis: Ein Auftrag ist neu, das Gerät steht schon auf dem
 * Hänger, und die Baustelle gibt es im System noch nicht. Wer dafür in die
 * Verwaltung wechseln müsste, bucht am Ende gar nicht oder auf den falschen
 * Ort — und dann stimmt der Bestand nicht mehr, was in dieser Anwendung der
 * teuerste Fehler überhaupt ist.
 *
 * Nur mit dem Recht `stammdaten.pflegen`; wer es nicht hat, sieht die
 * Auswahl wie bisher.
 */
/**
 * Ein Foto vom Zustand bei der Übergabe.
 *
 * Der Fall, für den es gedacht ist: Ein Gerät kommt beschädigt zurück, und
 * niemand kann belegen, wie es hinausging — bei Fremdfirmen der klassische
 * Streitpunkt. Das Bild hängt an der BUCHUNG, nicht am Gerät: Es
 * dokumentiert einen Zeitpunkt, keinen Dauerzustand.
 *
 * Freiwillig. Wer im Regen am Hänger steht, soll nicht fotografieren müssen.
 */
const foto = useFoto();
const fotoDatei = ref<File | null>(null);
const fotoVorschau = ref<string | null>(null);
const fotoWarnung = ref<string | null>(null);

async function fotoWaehlen(ereignis: Event): Promise<void> {
  const roh = (ereignis.target as HTMLInputElement).files?.[0];
  if (!roh) return;
  try {
    const fertig = await foto.vorbereiten(roh);
    fotoDatei.value = fertig.datei;
    fotoVorschau.value = fertig.vorschau;
    fotoWarnung.value = null;
  } catch {
    fotoWarnung.value = "Das Bild konnte nicht vorbereitet werden.";
  }
}

function fotoVerwerfen(): void {
  fotoDatei.value = null;
  fotoVorschau.value = null;
}

async function fotoHochladen(buchungId: string): Promise<void> {
  const formular = new FormData();
  formular.append("datei", fotoDatei.value!);
  formular.append("buchung_id", buchungId);
  try {
    const antwort = await fetch(`/api/geraete/${geraetId}/dateien`, {
      method: "POST",
      body: formular,
      credentials: "same-origin",
    });
    if (!antwort.ok) throw new Error();
  } catch {
    // Die Buchung steht bereits — das darf sie nicht mehr umwerfen.
    fotoWarnung.value =
      "Die Buchung ist gespeichert, das Foto konnte nicht übertragen werden.";
  }
}

const neuerOrtOffen = ref(false);
const neuerOrtName = ref("");
const neuerOrtLaeuft = ref(false);
const neuerOrtFehler = ref<string | null>(null);
const neuerOrtEl = ref<HTMLInputElement | null>(null);

const darfOrteAnlegen = computed(() => anmeldung.darf("stammdaten.pflegen"));

/** Warnt vor Dubletten, bevor gespeichert wird (siehe OrteView). */
const aehnlicherOrt = computed(() => {
  const eingabe = neuerOrtName.value.trim().toLowerCase();
  if (eingabe.length < 3) return null;
  return (
    bestand.standorte.find((s) => {
      const name = s.name.toLowerCase();
      return name === eingabe || name.includes(eingabe) || eingabe.includes(name);
    }) ?? null
  );
});

async function neuerOrtZeigen(): Promise<void> {
  neuerOrtOffen.value = true;
  neuerOrtFehler.value = null;
  await nextTick();
  neuerOrtEl.value?.focus();
}

async function neuenOrtAnlegen(): Promise<void> {
  const name = neuerOrtName.value.trim();
  if (neuerOrtLaeuft.value || !name) return;
  neuerOrtLaeuft.value = true;
  neuerOrtFehler.value = null;

  try {
    const neu = await api.post<Standort>("/standorte", { name, typ: "baustelle" });
    bestand.ergaenzeStandort(neu);
    // Direkt auswählen: Genau dorthin wollte der Benutzer ja buchen.
    standortId.value = neu.id;
    neuerOrtOffen.value = false;
    neuerOrtName.value = "";
  } catch (e) {
    neuerOrtFehler.value =
      e instanceof ApiError
        ? e.message
        : "Die Baustelle konnte nicht angelegt werden. Bitte noch einmal versuchen.";
  } finally {
    neuerOrtLaeuft.value = false;
  }
}
const empfaengerId = ref("");
const empfaengerFrei = ref("");
const fremdfirma = ref(false);
const rueckgabe = ref("");
const notiz = ref("");
const ausfall = ref(false);

const TITEL: Record<string, string> = {
  ausgabe: "Ausgeben",
  ruecknahme: "Zurücknehmen",
  umbuchung: "Umbuchen",
};

const istRuecknahme = computed(() => art === "ruecknahme");
const zielOrte = computed(() =>
  istRuecknahme.value ? bestand.lager : bestand.aktiveStandorte.filter((s) => s.typ !== "lager"),
);
const plaetze = computed(() =>
  standortId.value ? bestand.plaetzeAmStandort(standortId.value) : [],
);

const LETZTER_ORT = "gt-letzter-ort";

onMounted(async () => {
  try {
    await bestand.laden();
    geraet.value = await api.get<Geraet>(`/geraete/${geraetId}`);

    // Jeder darf die Namensliste sehen — sonst ließe sich nichts auf jemanden
    // buchen. Ohne das Recht "benutzer.verwalten" liefert die Route nur
    // Kennung, Name und Zustand, keine E-Mail und keine Rolle.
    personen.value = await api.get<{ id: string; anzeigename: string }[]>("/benutzer");

    empfaengerId.value = anmeldung.benutzer?.id ?? "";

    const gemerkt = localStorage.getItem(`${LETZTER_ORT}-${art}`);
    const passt = zielOrte.value.some((s) => s.id === gemerkt);
    standortId.value = passt && gemerkt ? gemerkt : (zielOrte.value[0]?.id ?? "");
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Konnte nicht laden";
  } finally {
    laedt.value = false;
  }
});

async function buchen(): Promise<void> {
  if (speichert.value) return;
  speichert.value = true;
  fehler.value = null;
  try {
    const antwort = await api.post<{ geraet: Geraet; buchung: { id: string } }>("/buchungen", {
      geraet_id: geraetId,
      art,
      nach_standort_id: standortId.value || null,
      nach_lagerplatz_id: lagerplatzId.value || null,
      empfaenger_id: fremdfirma.value ? null : empfaengerId.value || null,
      empfaenger_freitext: fremdfirma.value ? empfaengerFrei.value : null,
      geplante_rueckgabe: rueckgabe.value || null,
      notiz: notiz.value || null,
      ausfall: istRuecknahme.value ? ausfall.value : undefined,
    });

    bestand.ersetze(antwort.geraet);
    geraet.value = antwort.geraet;
    localStorage.setItem(`${LETZTER_ORT}-${art}`, standortId.value);

    // Das Foto NACH der Buchung: Es hängt an ihr, also muss sie zuerst
    // existieren. Scheitert der Upload, ist die Buchung trotzdem gültig —
    // ein Bild ist eine Beigabe, der Bestand ist die Hauptsache. Deshalb
    // gibt es hier eine eigene Meldung statt eines Abbruchs.
    if (fotoDatei.value && antwort.buchung?.id) {
      await fotoHochladen(antwort.buchung.id);
    }
    fertig.value = true;
  } catch (f) {
    fehler.value =
      f instanceof ApiError ? f.message : f instanceof Error ? f.message : "Buchung fehlgeschlagen";
  } finally {
    speichert.value = false;
  }
}
</script>

<template>
  <div>
    <Kopf :titel="TITEL[art] ?? 'Buchen'" zurueck :unter="geraet?.bezeichnung" />

    <div class="inhalt">
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>

      <!-- ── Bestätigung ──────────────────────────────────── -->
      <template v-else-if="fertig && geraet">
        <!-- Mit Handschuhen und bei Sonne lesbar: großes Zeichen,
             kurzer Satz, ein Hauptknopf. -->
        <div class="fertig">
          <div class="fertig__haken"><Symbol name="haken" :groesse="40" /></div>
          <h2 class="fertig__titel">
            {{ art === "ausgabe" ? "Ausgegeben" : art === "ruecknahme" ? "Zurückgenommen" : "Umgebucht" }}
          </h2>
          <p class="fertig__satz">
            {{ geraet.bezeichnung }}<br />
            <span class="pt-mono pt-gedaempft">{{ geraet.inventarnummer }}</span>
          </p>
          <p class="fertig__ziel">
            <StatusChip :status="geraet.status" gross />
          </p>
          <p v-if="geraet.standort" class="fertig__satz">
            {{ geraet.standort
            }}<template v-if="geraet.lagerplatz"> · {{ geraet.lagerplatz }}</template>
          </p>

          <!--
            Auch hier: Scheitert der Bild-Upload, ist die Buchung trotzdem
            erfolgt — aber der Benutzer muss es erfahren. Stand die Warnung
            nur im Formular, sah er sie nie, weil diese Ansicht sofort
            danach erscheint. Ein Test hat genau das gefunden.
          -->
          <p v-if="fotoWarnung" class="pt-meldung pt-meldung--warnung fertig__warnung">
            {{ fotoWarnung }}
          </p>
        </div>

        <div class="knoepfe">
          <button class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross" @click="router.push('/scan')">
            <Symbol name="scan" :groesse="20" />
            Nächstes Gerät scannen
          </button>
          <button class="pt-btn pt-btn--breit" @click="router.push(`/geraete/${geraetId}`)">
            Gerät ansehen
          </button>
        </div>
      </template>

      <!-- ── Formular ─────────────────────────────────────── -->
      <template v-else-if="geraet">
        <div class="pt-karte geraet">
          <div class="geraet__text">
            <div class="pt-zeile__titel">{{ geraet.bezeichnung }}</div>
            <div class="pt-zeile__unter pt-mono">{{ geraet.inventarnummer }}</div>
          </div>
          <StatusChip :status="geraet.status" />
        </div>

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <div class="feldgruppe">
          <label class="pt-label" for="ort">
            {{ istRuecknahme ? "Zurück ins Lager" : "Wohin geht das Gerät?" }}
          </label>
          <select id="ort" v-model="standortId" class="pt-feld">
            <option v-for="s in zielOrte" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>

          <!--
            Nur beim Hinausgeben: Ins Lager zurück geht es an einen Ort, den
            es längst gibt — dort wäre der Knopf nur im Weg.
          -->
          <template v-if="!istRuecknahme && darfOrteAnlegen">
            <button
              v-if="!neuerOrtOffen"
              type="button"
              class="pt-btn pt-btn--still neuer-ort__auf"
              @click="neuerOrtZeigen"
            >
              <Symbol name="plus" :groesse="18" /> Baustelle ist noch nicht dabei
            </button>

            <div v-else class="neuer-ort">
              <label class="pt-label" for="neuer-ort-name">Neue Baustelle</label>
              <input
                id="neuer-ort-name"
                ref="neuerOrtEl"
                v-model="neuerOrtName"
                class="pt-feld"
                maxlength="120"
                placeholder="z. B. Lindengasse 14"
                autocomplete="off"
                @keyup.enter="neuenOrtAnlegen"
              />
              <p v-if="aehnlicherOrt" class="pt-meldung pt-meldung--warnung">
                Es gibt bereits „{{ aehnlicherOrt.name }}“. Ist das derselbe Ort?
              </p>
              <p v-if="neuerOrtFehler" class="pt-meldung pt-meldung--fehler">
                {{ neuerOrtFehler }}
              </p>
              <div class="neuer-ort__knoepfe">
                <button
                  type="button"
                  class="pt-btn pt-btn--still"
                  @click="neuerOrtOffen = false"
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  class="pt-btn pt-btn--primaer"
                  :disabled="neuerOrtLaeuft || !neuerOrtName.trim()"
                  @click="neuenOrtAnlegen"
                >
                  {{ neuerOrtLaeuft ? "Wird angelegt …" : "Anlegen und wählen" }}
                </button>
              </div>
            </div>
          </template>
        </div>

        <div v-if="plaetze.length" class="feldgruppe">
          <label class="pt-label" for="platz">Lagerplatz (falls bekannt)</label>
          <select id="platz" v-model="lagerplatzId" class="pt-feld">
            <option value="">— kein bestimmter Platz —</option>
            <option v-for="p in plaetze" :key="p.id" :value="p.id">
              {{ p.bezeichnung }}<template v-if="p.barcode"> ({{ p.barcode }})</template>
            </option>
          </select>
        </div>

        <template v-if="!istRuecknahme">
          <div class="feldgruppe">
            <label class="pt-label" for="person">Wer übernimmt es?</label>
            <select v-if="!fremdfirma" id="person" v-model="empfaengerId" class="pt-feld">
              <option v-for="p in personen" :key="p.id" :value="p.id">{{ p.anzeigename }}</option>
            </select>
            <input
              v-else
              v-model="empfaengerFrei"
              class="pt-feld"
              type="text"
              placeholder="z. B. Fa. Huber, Hr. Mayer"
            />
            <button class="pt-btn pt-btn--still umschalter" @click="fremdfirma = !fremdfirma">
              {{ fremdfirma ? "Doch ein Mitarbeiter" : "Fremdfirma ohne Konto" }}
            </button>
          </div>

          <div class="feldgruppe">
            <label class="pt-label" for="rueckgabe">Rückgabe geplant am (freiwillig)</label>
            <input id="rueckgabe" v-model="rueckgabe" class="pt-feld" type="date" />
          </div>
        </template>

        <div v-else class="feldgruppe">
          <!-- Ein Ausfallschaden nimmt das Gerät sofort aus dem Umlauf.
               Deshalb steht der Schalter hier und nicht in einem Untermenü. -->
          <label class="schalter">
            <input v-model="ausfall" type="checkbox" />
            <span>
              <strong>Gerät ist defekt</strong>
              <small>Es wird gesperrt und lässt sich nicht mehr ausgeben.</small>
            </span>
          </label>
        </div>

        <div class="feldgruppe">
          <label class="pt-label" for="notiz">Notiz (freiwillig)</label>
          <input id="notiz" v-model="notiz" class="pt-feld" type="text" placeholder="Kurzer Vermerk" />
        </div>

        <!--
          Zustandsfoto: freiwillig, deshalb unauffällig. capture="environment"
          öffnet am Handy direkt die Rückkamera statt der Dateiauswahl.
        -->
        <div class="feldgruppe fotogruppe">
          <span class="pt-label">Zustand festhalten (freiwillig)</span>

          <div v-if="fotoVorschau" class="foto">
            <img :src="fotoVorschau" alt="Aufgenommenes Foto" class="foto__bild" />
            <button type="button" class="pt-btn pt-btn--still" @click="fotoVerwerfen">
              Foto verwerfen
            </button>
          </div>

          <label v-else class="pt-btn foto__aufnehmen">
            <Symbol name="plus" :groesse="18" />
            {{ foto.arbeitet.value ? "Bild wird vorbereitet …" : "Foto aufnehmen" }}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              class="foto__feld"
              @change="fotoWaehlen"
            />
          </label>

          <p v-if="fotoWarnung" class="pt-meldung pt-meldung--warnung">{{ fotoWarnung }}</p>
        </div>

        <div class="knoepfe">
          <button
            class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
            :disabled="speichert"
            @click="buchen"
          >
            {{ speichert ? "Wird gebucht …" : (TITEL[art] ?? "Buchen") }}
          </button>
          <button class="pt-btn pt-btn--breit" @click="router.back()">Abbrechen</button>
        </div>
      </template>
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

.geraet {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}
.geraet__text {
  flex: 1;
  min-width: 0;
}

.feldgruppe {
  display: flex;
  flex-direction: column;
}

.umschalter {
  align-self: flex-start;
  margin-top: var(--space-2);
  min-height: 36px;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.schalter {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.schalter input {
  width: 24px;
  height: 24px;
  margin: 0;
  flex: none;
  accent-color: var(--danger);
}
.schalter small {
  display: block;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.knoepfe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* ── Bestätigung ────────────────────────────────────────── */
.fertig {
  padding: var(--space-8) var(--space-4);
  text-align: center;
}
.fertig__haken {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  margin-bottom: var(--space-4);
  color: var(--success-fg);
  background: var(--success-bg);
  border: 2px solid var(--success-fg);
  border-radius: var(--radius-full);
}
.fertig__titel {
  font-size: var(--fs-24);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
  margin-bottom: var(--space-2);
}
.fertig__satz {
  font-size: var(--fs-16);
  color: var(--fg-body);
}
.fertig__ziel {
  margin: var(--space-4) 0;
}
.neuer-ort__auf {
  margin-top: var(--space-2);
  align-self: flex-start;
}
.neuer-ort {
  margin-top: var(--space-2);
  padding: var(--space-3);
  background: var(--surface-subtle);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.neuer-ort__knoepfe {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
.fertig__warnung {
  margin-top: var(--space-4);
  text-align: left;
}
/*
 * Beschriftung und Knopf in EINE Zeile, solange kein Bild gewählt ist.
 * Als eigene Zeile wuchs das Formular so weit, dass der Ausgeben-Knopf auf
 * gängigen Handys unter die Navigationsleiste rutschte — der Hauptweg
 * brauchte plötzlich einen Scrollvorgang, den er vorher nicht brauchte.
 */
.fotogruppe {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.fotogruppe:has(.foto) {
  flex-direction: column;
  align-items: stretch;
}

.foto {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  align-items: flex-start;
}
.foto__bild {
  max-width: 100%;
  max-height: 40dvh;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}
.foto__aufnehmen {
  align-self: flex-start;
  cursor: pointer;
}
/* Das Dateifeld selbst bleibt unsichtbar — das Label ist der Knopf. */
.foto__feld {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
</style>
