<script setup lang="ts">
/**
 * Ausgeben, Zurücknehmen, Umbuchen — in zwei Tippern.
 *
 * Standort und Person sind vorbelegt (zuletzt gewählt), aber änderbar.
 * Serienausgabe ist der Normalfall beim Bestücken eines Transporters,
 * deshalb führt die Bestätigung direkt zurück zum Scanner.
 *
 * Die Fachlichkeit steht seit AP25 in Composables, die sich diese Ansicht mit
 * `BuchenDialog`, `SammelBuchenView` und `SammelPanel` teilt. `buchen()`
 * selbst bleibt eigen: Der Ausgang dieser Ansicht ist eine eigene
 * Bestätigungsseite mit „Nächstes Gerät scannen", und der ist an keiner der
 * drei anderen Stellen derselbe.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api";
import { meldeDefekt, sendeEinzelbuchung, sendeRuecknahmeDefekt, sendeSammelbuchung, type Buchungsangaben } from "@/buchen";
import { meldungAus } from "@/meldung";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import { useBuchungsziel } from "@/composables/useBuchungsziel";
import { useEmpfaenger } from "@/composables/useEmpfaenger";
import { useNeueBaustelle } from "@/composables/useNeueBaustelle";
import { useZubehoerwahl } from "@/composables/useZubehoerwahl";
import { useZustandsfoto } from "@/composables/useZustandsfoto";
import type { Buchungsart, Geraet } from "@/typen";
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
const laedt = ref(true);
const speichert = ref(false);
const fehler = ref<string | null>(null);
const fertig = ref(false);

const rueckgabe = ref("");
const notiz = ref("");
const ausfall = ref(false);
const defektWarnung = ref<string | null>(null);

const TITEL: Record<string, string> = {
  ausgabe: "Ausgeben",
  ruecknahme: "Zurücknehmen",
  umbuchung: "Umbuchen",
};

const istRuecknahme = computed(() => art === "ruecknahme");

/**
 * Der Ausfall-Schalter meldet seit AP25 einen SCHADEN, keine gesperrte
 * Buchung (siehe `buchen.ts`). Deshalb hängt er am Recht `schaeden.melden` —
 * wer es nicht hat, soll den Schalter gar nicht erst sehen statt ihn zu
 * setzen und danach eine Fehlermeldung zu bekommen, die nichts mehr ändert.
 * Die mitgelieferte Rolle „Mitarbeiter" hat das Recht.
 */
const darfSchadenMelden = computed(() => anmeldung.darf("schaeden.melden"));

const { standortId, lagerplatzId, zielOrte, plaetze, merke } = useBuchungsziel(() => art);

const {
  personen,
  empfaengerId,
  empfaengerFrei,
  fremdfirma,
  empfaengerFelder,
  laden: empfaengerLaden,
} = useEmpfaenger();

/** Bleibt hier: Ein Ref, den nur `ref="…"` liest, gilt sonst als ungelesen. */
const neuerOrtEl = ref<HTMLInputElement | null>(null);

const {
  offen: neuerOrtOffen,
  name: neuerOrtName,
  laeuft: neuerOrtLaeuft,
  fehler: neuerOrtFehler,
  darfAnlegen: darfOrteAnlegen,
  aehnlich: aehnlicherOrt,
  zeigen: neuerOrtZeigen,
  schliessen: neuerOrtSchliessen,
  anlegen: neuenOrtAnlegen,
} = useNeueBaustelle(standortId, () => neuerOrtEl.value?.focus());

// Eine einelementige Liste: Beim Einzelvorgang ist das Gerät die ganze
// „Sammlung". Damit gilt hier dieselbe Regel wie am Sammelweg — auch die
// Entdopplung, die verhindert, dass ein Gerät sich selbst als Zubehör
// anbietet.
const {
  zubehoer,
  gewaehlt: zubehoerGewaehlt,
  istGewaehlt,
  umschalten: zubehoerUmschalten,
  laden: zubehoerLaden,
} = useZubehoerwahl(
  () => [geraetId],
  () => art,
);

const {
  foto,
  datei: fotoDatei,
  vorschau: fotoVorschau,
  warnung: fotoWarnung,
  darfHochladen: darfFotoHochladen,
  waehlen: fotoWaehlen,
  verwerfen: fotoVerwerfen,
  hochladen: fotoHochladen,
} = useZustandsfoto(() => geraetId);

onMounted(async () => {
  try {
    await bestand.laden();
    geraet.value = await api.get<Geraet>(`/geraete/${geraetId}`);
  } catch (f) {
    fehler.value = meldungAus(f, "Konnte nicht laden");
  } finally {
    laedt.value = false;
  }

  // Beide fangen ihre Fehler selbst ab: Ohne Zubehörliste bleibt die Ansicht
  // wie eine ohne Zubehör, und der Weg „Fremdfirma ohne Konto" braucht gar
  // keine Namensliste. Eine ausgefallene Nebenroute darf das Formular nicht
  // kosten.
  await Promise.all([zubehoerLaden(), empfaengerLaden()]);
});

/**
 * Den Defekt nachtragen, nachdem die Rücknahme steht.
 *
 * Scheitert das, bleibt die Buchung gültig — sie ist die Hauptsache. Der
 * Benutzer erfährt es aber, sonst hielte er das Gerät für gesperrt.
 */
async function defektNachtragen(buchungId: string | null): Promise<void> {
  try {
    const antwort = await meldeDefekt(geraetId, buchungId, notiz.value);
    bestand.ersetze(antwort.geraet);
    geraet.value = antwort.geraet;
  } catch {
    defektWarnung.value =
      "Die Buchung ist gespeichert, der Defekt konnte nicht gemeldet werden. " +
      "Bitte den Schaden am Gerät nachtragen.";
  }
}

async function buchen(): Promise<void> {
  if (speichert.value) return;
  speichert.value = true;
  fehler.value = null;

  const angaben: Buchungsangaben = {
    art,
    standortId: standortId.value,
    lagerplatzId: lagerplatzId.value,
    empfaenger: empfaengerFelder.value,
    rueckgabe: rueckgabe.value,
    notiz: notiz.value,
  };

  try {
    let eigene: { id: string } | null = null;

    if (istRuecknahme.value && ausfall.value && !zubehoerGewaehlt.value.length) {
      const antwort = await sendeRuecknahmeDefekt(geraetId, angaben, notiz.value);
      bestand.ersetze(antwort.geraet);
      geraet.value = antwort.geraet;
    } else if (zubehoerGewaehlt.value.length) {
      const sammel = await sendeSammelbuchung([geraetId, ...zubehoerGewaehlt.value], angaben);
      for (const g of sammel.geraete) bestand.ersetze(g);
      const eigenes = sammel.geraete.find((g) => g.id === geraetId);
      if (eigenes) geraet.value = eigenes;
      eigene = sammel.buchungen.find((b) => b.geraet_id === geraetId) ?? null;
    } else {
      const antwort = await sendeEinzelbuchung(geraetId, angaben);
      bestand.ersetze(antwort.geraet);
      geraet.value = antwort.geraet;
      eigene = antwort.buchung;
    }

    merke();

    if (fotoDatei.value && eigene?.id) await fotoHochladen(eigene.id);

    // Sammelweg mit Defekt: weiterhin zwei Aufrufe (das Zubehör darf nicht
    // mitgesperrt werden). Einzelweg läuft über die transaktionale Route.
    if (istRuecknahme.value && ausfall.value && zubehoerGewaehlt.value.length) {
      await defektNachtragen(eigene?.id ?? null);
    }

    fertig.value = true;
  } catch (f) {
    fehler.value = meldungAus(f, "Buchung fehlgeschlagen");
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
          <p v-if="defektWarnung" class="pt-meldung pt-meldung--warnung fertig__warnung">
            {{ defektWarnung }}
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
                <button type="button" class="pt-btn pt-btn--still" @click="neuerOrtSchliessen">
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
            <!-- 120 Zeichen wie der Server (`empfaenger_freitext`): Ohne die
                 Grenze tippt man einen Satz und bekommt erst beim Absenden
                 eine Fehlermeldung. -->
            <input
              v-else
              v-model="empfaengerFrei"
              class="pt-feld"
              type="text"
              maxlength="120"
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

        <!-- Ein Ausfallschaden nimmt das Gerät sofort aus dem Umlauf. Deshalb
             steht der Schalter hier und nicht in einem Untermenü. Er braucht
             `schaeden.melden`, weil daraus eine Schadensmeldung wird. -->
        <div v-else-if="darfSchadenMelden" class="feldgruppe">
          <label class="schalter">
            <input v-model="ausfall" type="checkbox" />
            <span>
              <strong>Gerät ist defekt</strong>
              <small>Es wird als Schaden erfasst und lässt sich nicht mehr ausgeben.</small>
            </span>
          </label>
        </div>

        <!--
          Zubehör: nur sichtbar, wenn es welches gibt. Vorangehakt, weil es
          der Regelfall ist — der Löffel fährt mit dem Bagger.
        -->
        <div v-if="zubehoer.length" class="feldgruppe">
          <span class="pt-label">Zubehör mitnehmen</span>
          <ul class="pt-liste zubehoer">
            <li v-for="z in zubehoer" :key="z.id" class="zubehoer__zeile">
              <label class="haken">
                <input
                  type="checkbox"
                  class="haken__feld"
                  :checked="istGewaehlt(z.id)"
                  @change="zubehoerUmschalten(z.id)"
                />
                <span>
                  <span class="pt-zeile__titel">{{ z.bezeichnung }}</span>
                  <span class="pt-zeile__unter pt-mono">{{ z.inventarnummer }}</span>
                </span>
              </label>
              <StatusChip :status="z.status" />
            </li>
          </ul>
        </div>

        <div class="feldgruppe">
          <label class="pt-label" for="notiz">Notiz (freiwillig)</label>
          <!-- 2000 Zeichen wie der Server (`notiz`). -->
          <input
            id="notiz"
            v-model="notiz"
            class="pt-feld"
            type="text"
            maxlength="2000"
            placeholder="Kurzer Vermerk"
          />
        </div>

        <!--
          Zustandsfoto: freiwillig, deshalb unauffällig. capture="environment"
          öffnet am Handy direkt die Rückkamera statt der Dateiauswahl.

          Nur mit `dateien.hochladen`: Ohne das Recht ginge die Buchung durch
          und das Bild scheiterte — der Benutzer hätte im Regen umsonst
          fotografiert, ohne je den Grund zu erfahren.
        -->
        <div v-if="darfFotoHochladen" class="feldgruppe fotogruppe">
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
.zubehoer {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.zubehoer__zeile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.haken {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-height: 48px;
  cursor: pointer;
}
.haken__feld {
  width: 22px;
  height: 22px;
  flex: none;
}
.haken span span {
  display: block;
}
</style>
