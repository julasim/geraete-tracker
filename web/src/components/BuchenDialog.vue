<script setup lang="ts">
/**
 * Ausgeben, Zurücknehmen, Umbuchen — als Dialog über der Liste.
 *
 * Am Handy ist das eine eigene Seite (`views/BuchenView.vue`): Auf der
 * Baustelle wird einhändig bedient, und ein 560 px breiter Dialog hat dort
 * keinen Platz. Am Schreibtisch ist der Seitenwechsel dagegen ein Verlust —
 * die Liste, aus der man kommt, ist der Zusammenhang. Deshalb ab 1024 px
 * derselbe Vorgang als Dialog, und die Liste bleibt stehen.
 *
 * **Die Fachlichkeit ist die der Handy-Ansicht, unverändert:** Ziel und
 * Person vorbelegt (zuletzt gewählt, aus dem localStorage — derselbe
 * Schlüssel, damit Handy und Computer dieselbe Vorbelegung teilen), Zubehör
 * vorangehakt und abwählbar, Baustelle aus dem Vorgang heraus anlegbar,
 * Ausfall-Schalter bei der Rücknahme, Zustandsfoto freiwillig. Nur die
 * Hülle ist anders.
 *
 * Genau eine Sache entfällt: die eigene Bestätigungsseite. Sie ist ein
 * Handy-Muster („Nächstes Gerät scannen"); am Computer steht die Liste ja
 * schon da und frischt sich auf.
 *
 * ── So bindet ein Aufrufer ihn ein ────────────────────────────────────────
 *
 *   <BuchenDialog
 *     v-if="dialog"
 *     :geraet="dialog.geraet"
 *     :art="dialog.art"
 *     @schliessen="dialog = null"
 *     @gebucht="(b) => { meldung = 'Gebucht.'; dialog = null }"
 *   />
 *
 * Die Sichtbarkeit steuert **allein der Aufrufer** über `v-if` — der Dialog
 * kennt kein `offen`-Prop. Beim Einhängen lädt er selbst, was er braucht
 * (Zubehör, Personen, Warnungen); ein zweites Öffnen beginnt damit von vorn,
 * ohne Reste des vorigen Vorgangs.
 *
 * **Der Aufrufer muss auf BEIDE Ereignisse schließen.** `gebucht` meldet die
 * Buchung dieses Geräts und ist das Ende des Vorgangs, `schliessen` kommt
 * beim Abbrechen. Der Dialog schließt sich nie selbst — er weiß nicht, wem
 * er gehört.
 *
 * **Warum `gebucht` nach einer Warnung wartet:** Die Buchung steht dann
 * bereits, nur das Bild oder die Defektmeldung ging nicht durch. Verschwände
 * der Dialog sofort, läse niemand die Warnung dazu und hielte beides für
 * gespeichert. Genau dieser Fehler ist am Handy schon einmal passiert
 * (AP22). Deshalb bleibt der Dialog stehen und meldet `gebucht` erst, wenn
 * der Benutzer die Warnung gelesen und geschlossen hat.
 */
import { computed, onMounted, ref } from "vue";
import { api } from "@/api";
import { meldeDefekt, sendeEinzelbuchung, sendeRuecknahmeDefekt, sendeSammelbuchung, type Buchungsangaben } from "@/buchen";
import { meldungAus } from "@/meldung";
import { useBreite } from "@/composables/useBreite";
import { useBuchungsziel } from "@/composables/useBuchungsziel";
import { useEmpfaenger } from "@/composables/useEmpfaenger";
import { useNeueBaustelle } from "@/composables/useNeueBaustelle";
import { useZubehoerwahl } from "@/composables/useZubehoerwahl";
import { useZustandsfoto } from "@/composables/useZustandsfoto";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Buchung, Buchungsart, Geraet, Warnung } from "@/typen";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";

const props = defineProps<{
  /** Das Gerät, um das es geht. */
  geraet: Geraet;
  /** Welche Buchung: ausgabe, ruecknahme, umbuchung. */
  art: Buchungsart;
}>();

const emit = defineEmits<{
  /** Abbrechen, Schließen-Kreuz, Escape, Klick aufs Overlay. */
  schliessen: [];
  /** Buchung erfolgreich — der Aufrufer aktualisiert seine Liste. */
  gebucht: [buchung: Buchung];
}>();

const bestand = useBestand();
const anmeldung = useAnmeldung();
/** Nur für die Tippziele: Mit dem Finger am iPad sind 40 px zu wenig. */
const { tablet } = useBreite();

const TITEL: Record<string, string> = {
  ausgabe: "Ausgeben",
  ruecknahme: "Zurücknehmen",
  umbuchung: "Umbuchen",
};

const titel = computed(() => TITEL[props.art] ?? "Buchen");
const istRuecknahme = computed(() => props.art === "ruecknahme");

const laedt = ref(true);
const speichert = ref(false);
const fehler = ref<string | null>(null);

/**
 * Die Warnungen des Servers, wortgleich.
 *
 * Sie stammen aus `GET /scan/:nummer` — derselben Quelle wie beim Scannen am
 * Handy, damit Gerätekarte und Dialog nie Verschiedenes behaupten. Hier
 * nichts dazuerfinden: Ob eine Prüfung überfällig ist, rechnet der Server.
 */
const warnungen = ref<Warnung[]>([]);

const rueckgabe = ref("");
const notiz = ref("");
const ausfall = ref(false);
const defektWarnung = ref<string | null>(null);

/**
 * Der Ausfall-Schalter meldet seit AP25 einen SCHADEN, keine gesperrte
 * Buchung (siehe `buchen.ts`). Deshalb hängt er am Recht `schaeden.melden`.
 */
const darfSchadenMelden = computed(() => anmeldung.darf("schaeden.melden"));

/** Steht die Buchung schon? Dann ist höchstens noch das Foto offen. */
const gebuchte = ref<Buchung | null>(null);

const { standortId, lagerplatzId, zielOrte, plaetze, merke } = useBuchungsziel(() => props.art);

const {
  personen,
  empfaengerId,
  empfaengerFrei,
  fremdfirma,
  empfaengerFelder,
  laden: empfaengerLaden,
} = useEmpfaenger();

/** Nummer und aktueller Standort in einer Zeile: „10014 · Bauhof Nord, Regal C3". */
const standortZeile = computed(() => {
  const ort = [props.geraet.standort, props.geraet.lagerplatz].filter(Boolean).join(", ");
  return [props.geraet.inventarnummer, ort].filter(Boolean).join(" · ");
});

// ── Zubehör, Foto, neue Baustelle ──────────────────────────────────────────
//
// Alles drei teilt sich der Dialog seit AP25 mit der Handy-Ansicht. Sie
// standen bis dahin hier ein zweites Mal — und liefen auseinander: Beim Weg
// mit Zubehör verschwand der Ausfall-Schalter stillschweigend, und ein
// abgewähltes Zubehörteil hakte sich beim nächsten Laden wieder an.

const {
  zubehoer,
  gewaehlt: zubehoerGewaehlt,
  istGewaehlt,
  umschalten: zubehoerUmschalten,
  laden: zubehoerLaden,
} = useZubehoerwahl(
  () => [props.geraet.id],
  () => props.art,
);

const {
  foto,
  datei: fotoDatei,
  vorschau: fotoVorschau,
  warnung: fotoWarnung,
  uebertragungFehlt,
  darfHochladen: darfFotoHochladen,
  waehlen: fotoWaehlen,
  verwerfen: fotoVerwerfen,
  hochladen: fotoHochladen,
} = useZustandsfoto(() => props.geraet.id);

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

// ── Tastatur und Fokus ─────────────────────────────────────────────────────

const dialogEl = ref<HTMLElement | null>(null);

/** Was sich mit der Tabulatortaste erreichen lässt. */
const FOKUSSIERBAR =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])," +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Der Fokus darf nicht hinter den Dialog wandern.
 *
 * Sonst tippt man sich mit der Tabulatortaste in die Tabelle dahinter, ohne
 * es zu sehen, und löst dort eine Aktion aus, die man nicht gemeint hat. Die
 * Liste ist ja nur verdeckt, nicht weg.
 */
function fokusHalten(e: KeyboardEvent): void {
  const wurzel = dialogEl.value;
  if (!wurzel) return;
  const ziele = Array.from(wurzel.querySelectorAll<HTMLElement>(FOKUSSIERBAR));
  if (!ziele.length) return;

  const erstes = ziele[0]!;
  const letztes = ziele[ziele.length - 1]!;
  const aktiv = document.activeElement;

  if (e.shiftKey && (aktiv === erstes || aktiv === wurzel)) {
    e.preventDefault();
    letztes.focus();
  } else if (!e.shiftKey && aktiv === letztes) {
    e.preventDefault();
    erstes.focus();
  }
}

function beiTaste(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    // Ist die Baustellen-Eingabe offen, gehört Escape ihr: Sonst kostet ein
    // Tastendruck den ganzen ausgefüllten Dialog.
    if (neuerOrtOffen.value) {
      neuerOrtSchliessen();
      return;
    }
    emit("schliessen");
  } else if (e.key === "Tab") {
    fokusHalten(e);
  }
}

// ── Laden ──────────────────────────────────────────────────────────────────

onMounted(async () => {
  dialogEl.value?.focus();
  try {
    await bestand.laden();

    const nummer = props.geraet.inventarnummer;
    // Zubehör und Personenliste fangen ihre Fehler selbst ab: Ohne sie bleibt
    // der Dialog bedienbar. Der Scan ist ebenso nebensächlich — er liefert
    // nur die Warnungen.
    const [, , gescannt] = await Promise.all([
      zubehoerLaden(),
      empfaengerLaden(),
      nummer
        ? api.get<{ warnungen: Warnung[] }>(`/scan/${encodeURIComponent(nummer)}`).catch(() => null)
        : Promise.resolve(null),
    ]);

    warnungen.value = gescannt?.warnungen ?? [];
  } catch (f) {
    fehler.value = meldungAus(f, "Konnte nicht laden");
  } finally {
    laedt.value = false;
  }
});

// ── Buchen ─────────────────────────────────────────────────────────────────

/**
 * Den Defekt nachtragen, nachdem die Rücknahme steht. Scheitert das, bleibt
 * die Buchung gültig — der Benutzer erfährt es aber, sonst hielte er das
 * Gerät für gesperrt.
 */
async function defektNachtragen(buchungId: string): Promise<void> {
  try {
    const antwort = await meldeDefekt(props.geraet.id, buchungId, notiz.value);
    bestand.ersetze(antwort.geraet);
  } catch {
    defektWarnung.value =
      "Die Buchung ist gespeichert, der Defekt konnte nicht gemeldet werden. " +
      "Bitte den Schaden am Gerät nachtragen.";
  }
}

async function buchen(): Promise<void> {
  if (speichert.value || laedt.value || gebuchte.value) return;
  speichert.value = true;
  fehler.value = null;

  const angaben: Buchungsangaben = {
    art: props.art,
    standortId: standortId.value,
    lagerplatzId: lagerplatzId.value,
    empfaenger: empfaengerFelder.value,
    rueckgabe: rueckgabe.value,
    notiz: notiz.value,
  };

  try {
    let eigene: Buchung | null = null;

    if (istRuecknahme.value && ausfall.value && !zubehoerGewaehlt.value.length) {
      const antwort = await sendeRuecknahmeDefekt(props.geraet.id, angaben, notiz.value);
      bestand.ersetze(antwort.geraet);
    } else if (zubehoerGewaehlt.value.length) {
      const sammel = await sendeSammelbuchung(
        [props.geraet.id, ...zubehoerGewaehlt.value],
        angaben,
      );
      for (const g of sammel.geraete) bestand.ersetze(g);
      const treffer = sammel.buchungen.find((b) => b.geraet_id === props.geraet.id);
      if (!treffer) throw new Error("Buchung fehlgeschlagen");
      eigene = treffer;
    } else {
      const antwort = await sendeEinzelbuchung(props.geraet.id, angaben);
      bestand.ersetze(antwort.geraet);
      eigene = antwort.buchung;
    }

    merke();
    if (eigene) gebuchte.value = eigene;

    if (fotoDatei.value && eigene?.id) await fotoHochladen(eigene.id);

    // Sammelweg mit Defekt: zwei Aufrufe (Zubehör darf nicht mitgesperrt werden).
    if (istRuecknahme.value && ausfall.value && zubehoerGewaehlt.value.length && eigene) {
      await defektNachtragen(eigene.id);
    }

    if (!uebertragungFehlt.value && !defektWarnung.value) {
      emit("gebucht", eigene ?? ({} as Buchung));
    }
  } catch (f) {
    fehler.value = meldungAus(f, "Buchung fehlgeschlagen");
  } finally {
    speichert.value = false;
  }
}

/** Der Weg aus dem Dialog, wenn die Buchung steht, das Foto aber nicht. */
function fertigSchliessen(): void {
  if (gebuchte.value) emit("gebucht", gebuchte.value);
}
</script>

<template>
  <div
    class="buchschleier"
    :class="{ 'buchschleier--tablet': tablet }"
    @click.self="emit('schliessen')"
    @keydown="beiTaste"
  >
    <div
      ref="dialogEl"
      class="buchdialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="buchdialog-titel"
      tabindex="-1"
    >
      <!-- ── Kopf ──────────────────────────────────────────── -->
      <div class="buchdialog__kopf">
        <div class="buchdialog__wer">
          <p class="pt-mikro">{{ titel }}</p>
          <h2 id="buchdialog-titel" class="buchdialog__titel">{{ geraet.bezeichnung }}</h2>
          <p class="pt-mono buchdialog__nummer">{{ standortZeile }}</p>
        </div>
        <button
          type="button"
          class="buchdialog__schliessen"
          aria-label="Dialog schließen"
          @click="emit('schliessen')"
        >
          <Symbol name="schliessen" :groesse="18" />
        </button>
      </div>

      <!-- ── Körper ────────────────────────────────────────── -->
      <div class="buchdialog__koerper">
        <p v-if="laedt" class="pt-leer">Wird geladen …</p>

        <template v-else>
          <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

          <!--
            Warnungen wortgleich vom Server, und ganz oben: Wer ein Gerät mit
            abgelaufener Prüfung hinausgibt, soll es vorher wissen.
          -->
          <p
            v-for="(w, i) in warnungen"
            :key="i"
            class="pt-meldung pt-meldung--warnung buchmeldung"
          >
            <Symbol name="warnung" :groesse="18" />
            <span>{{ w.text }}</span>
          </p>

          <p v-if="fotoWarnung" class="pt-meldung pt-meldung--warnung buchmeldung">
            <Symbol name="warnung" :groesse="18" />
            <span>{{ fotoWarnung }}</span>
          </p>

          <p v-if="defektWarnung" class="pt-meldung pt-meldung--warnung buchmeldung">
            <Symbol name="warnung" :groesse="18" />
            <span>{{ defektWarnung }}</span>
          </p>

          <!--
            Steht die Buchung, sind die Felder gegenstandslos: Buchungen sind
            unveränderlich, eine Berichtigung ist eine Gegenbuchung.
          -->
          <template v-if="!gebuchte">
            <div class="buchraster">
              <div class="buchfeld" :class="{ 'buchfeld--breit': neuerOrtOffen }">
                <label class="pt-label" for="bd-ort">
                  {{ istRuecknahme ? "Zurück ins Lager" : "Wohin geht das Gerät?" }}
                </label>
                <select id="bd-ort" v-model="standortId" class="pt-feld">
                  <option v-for="s in zielOrte" :key="s.id" :value="s.id">{{ s.name }}</option>
                </select>

                <!--
                  Nur beim Hinausgeben: Ins Lager zurück geht es an einen Ort,
                  den es längst gibt — dort wäre der Knopf nur im Weg.
                -->
                <template v-if="!istRuecknahme && darfOrteAnlegen">
                  <button
                    v-if="!neuerOrtOffen"
                    type="button"
                    class="pt-btn pt-btn--still buchneuort__auf"
                    @click="neuerOrtZeigen"
                  >
                    <Symbol name="plus" :groesse="16" /> Baustelle ist noch nicht dabei
                  </button>

                  <div v-else class="buchneuort">
                    <label class="pt-label" for="bd-neuer-ort">Neue Baustelle</label>
                    <input
                      id="bd-neuer-ort"
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
                    <div class="buchneuort__knoepfe">
                      <button
                        type="button"
                        class="pt-btn pt-btn--still"
                        @click="neuerOrtSchliessen"
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

              <div v-if="plaetze.length" class="buchfeld">
                <label class="pt-label" for="bd-platz">Lagerplatz (falls bekannt)</label>
                <select id="bd-platz" v-model="lagerplatzId" class="pt-feld">
                  <option value="">— kein bestimmter Platz —</option>
                  <option v-for="p in plaetze" :key="p.id" :value="p.id">
                    {{ p.bezeichnung }}<template v-if="p.barcode"> ({{ p.barcode }})</template>
                  </option>
                </select>
              </div>

              <div v-if="!istRuecknahme" class="buchfeld">
                <label class="pt-label" for="bd-person">Wer übernimmt es?</label>
                <select v-if="!fremdfirma" id="bd-person" v-model="empfaengerId" class="pt-feld">
                  <option v-for="p in personen" :key="p.id" :value="p.id">
                    {{ p.anzeigename }}
                  </option>
                </select>
                <input
                  v-else
                  id="bd-person"
                  v-model="empfaengerFrei"
                  class="pt-feld"
                  type="text"
                  maxlength="120"
                  placeholder="z. B. Fa. Huber, Hr. Mayer"
                />
                <button
                  type="button"
                  class="pt-btn pt-btn--still buchumschalter"
                  @click="fremdfirma = !fremdfirma"
                >
                  {{ fremdfirma ? "Doch ein Mitarbeiter" : "Fremdfirma ohne Konto" }}
                </button>
              </div>

              <div v-if="!istRuecknahme" class="buchfeld">
                <label class="pt-label" for="bd-rueckgabe">Rückgabe geplant am (freiwillig)</label>
                <input id="bd-rueckgabe" v-model="rueckgabe" class="pt-feld" type="date" />
              </div>

              <div class="buchfeld">
                <label class="pt-label" for="bd-notiz">Notiz (freiwillig)</label>
                <input
                  id="bd-notiz"
                  v-model="notiz"
                  class="pt-feld"
                  type="text"
                  maxlength="2000"
                  placeholder="Kurzer Vermerk"
                />
              </div>

              <!--
                Ein Ausfallschaden nimmt das Gerät sofort aus dem Umlauf.
                Deshalb steht der Schalter hier und nicht in einem Untermenü.
                Er braucht `schaeden.melden`, weil daraus eine
                Schadensmeldung wird.
              -->
              <label v-if="istRuecknahme && darfSchadenMelden" class="buchschalter">
                <input v-model="ausfall" type="checkbox" class="buchschalter__feld" />
                <span>
                  <strong>Gerät ist defekt</strong>
                  <small>Es wird als Schaden erfasst und lässt sich nicht mehr ausgeben.</small>
                </span>
              </label>
            </div>

            <div v-if="zubehoer.length" class="buchzubehoer">
              <span class="pt-label">Zubehör mitnehmen</span>
              <ul class="pt-liste buchzubehoer__liste">
                <li v-for="z in zubehoer" :key="z.id" class="buchzubehoer__zeile">
                  <label class="buchhaken">
                    <input
                      type="checkbox"
                      class="buchhaken__feld"
                      :checked="istGewaehlt(z.id)"
                      @change="zubehoerUmschalten(z.id)"
                    />
                    <span class="buchhaken__text">
                      <span class="pt-zeile__titel">{{ z.bezeichnung }}</span>
                      <span class="pt-zeile__unter pt-mono">{{ z.inventarnummer }}</span>
                    </span>
                  </label>
                  <StatusChip :status="z.status" />
                </li>
              </ul>
            </div>

            <div v-if="fotoVorschau" class="buchfoto">
              <img :src="fotoVorschau" alt="Aufgenommenes Foto" class="buchfoto__bild" />
              <button type="button" class="pt-btn pt-btn--still" @click="fotoVerwerfen">
                Foto verwerfen
              </button>
            </div>
          </template>
        </template>
      </div>

      <!-- ── Fuß ───────────────────────────────────────────── -->
      <div class="buchdialog__fuss">
        <template v-if="gebuchte">
          <span class="buchfoto__hinweis">Die Buchung ist erfasst.</span>
          <span class="buchdialog__knoepfe">
            <button type="button" class="pt-btn pt-btn--primaer" @click="fertigSchliessen">
              Schließen
            </button>
          </span>
        </template>

        <template v-else>
          <!--
            Freiwillig, deshalb unauffällig: ein stiller Knopf links außen.
            Nur mit `dateien.hochladen` — ohne das Recht ginge die Buchung
            durch und das Bild scheiterte, ohne dass der Grund irgendwo
            stünde. Der leere Platzhalter hält die Knöpfe rechts außen.
          -->
          <template v-if="darfFotoHochladen">
            <label v-if="!fotoVorschau" class="pt-btn pt-btn--still buchfoto__auf">
              <Symbol name="kamera" :groesse="16" />
              {{ foto.arbeitet.value ? "Bild wird vorbereitet …" : "Zustand fotografieren" }}
              <input type="file" accept="image/*" class="buchfoto__feld" @change="fotoWaehlen" />
            </label>
            <span v-else class="buchfoto__hinweis">Foto ausgewählt.</span>
          </template>
          <span v-else></span>

          <span class="buchdialog__knoepfe">
            <button type="button" class="pt-btn" @click="emit('schliessen')">Abbrechen</button>
            <button
              type="button"
              class="pt-btn pt-btn--primaer"
              :disabled="speichert || laedt"
              @click="buchen"
            >
              {{ speichert ? "Wird gebucht …" : titel }}
            </button>
          </span>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Alle Klassen tragen das Präfix `buch…` und kommen im Projekt sonst
 * nirgends vor.
 *
 * Der Grund ist eine Falle, die hier schon zugeschlagen hat: Vue vergibt das
 * scoped-Attribut der ELTERN-Komponente auch an das Wurzelelement des Kindes.
 * Die Regel `.leiste` aus `AppShell.vue` traf so die Seitenleiste und drückte
 * sie als 60 px hohen Streifen an den unteren Rand. Bei einem Wurzelelement,
 * dessen Klassenname sonst nirgends steht, kann das nicht passieren.
 */
.buchschleier {
  position: fixed;
  inset: 0;
  /* Über allem: Bildlupe der Galerie (50), untere Leiste (20), Kopfzeile (10). */
  z-index: 60;
  display: grid;
  place-items: center;
  padding: var(--space-6);
  background: rgba(10, 10, 10, 0.32);
}

.buchdialog {
  display: flex;
  flex-direction: column;
  width: 560px;
  max-width: 100%;
  max-height: 100%;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  /* Der einzige Schatten der Anwendung — nur Schwebendes bekommt einen. */
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/*
 * Der Dialog nimmt beim Öffnen den Fokus, ist selbst aber kein Bedienelement:
 * Ein Rahmen darum sähe nach Eingabefeld aus. Betroffen ist ausschließlich
 * dieser Container — die Fokusumrandung der Knöpfe und Felder bleibt.
 */
.buchdialog:focus {
  outline: none;
}

/* ── Kopf ──────────────────────────────────────────────────── */
.buchdialog__kopf {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  flex: none;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--border);
}
.buchdialog__wer {
  min-width: 0;
}
.buchdialog__titel {
  margin-top: var(--space-1);
  font-size: var(--fs-18);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
}
.buchdialog__nummer {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.buchdialog__schliessen {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  background: none;
  border: 0;
  border-radius: var(--radius-md);
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    color var(--t-fast) var(--ease);
}
.buchdialog__schliessen:hover {
  background: var(--surface-muted);
  color: var(--fg);
}

/* ── Körper ────────────────────────────────────────────────── */
.buchdialog__koerper {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
  overflow-y: auto;
}

.buchmeldung {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
}
/* :deep, weil das SVG die Wurzel der Kindkomponente Symbol.vue ist. */
.buchmeldung :deep(svg) {
  flex: none;
  margin-top: 1px;
}

.buchraster {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-4);
}
.buchfeld {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/*
 * Ist die Baustellen-Eingabe offen, nimmt das Zielfeld die ganze Zeile: In
 * einer halben Spalte stünden Eingabefeld, Dublettenwarnung und zwei Knöpfe
 * auf 236 px übereinandergestapelt.
 */
.buchfeld--breit {
  grid-column: 1 / -1;
}

.buchneuort__auf {
  align-self: flex-start;
  margin-top: var(--space-2);
  min-height: 32px;
  padding: 0 var(--space-2);
  font-size: var(--fs-13);
  color: var(--fg-muted);
  /* pt-btn setzt nowrap — der lange Satz muss in der schmalen Spalte umbrechen. */
  white-space: normal;
  text-align: left;
}
.buchneuort {
  margin-top: var(--space-2);
  padding: var(--space-3);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  background: var(--surface-subtle);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-md);
}
.buchneuort__knoepfe {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
}
.buchneuort__knoepfe .pt-btn {
  min-height: 40px;
}

.buchumschalter {
  align-self: flex-start;
  margin-top: var(--space-2);
  min-height: 32px;
  padding: 0 var(--space-2);
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.buchschalter {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.buchschalter__feld {
  width: 20px;
  height: 20px;
  margin: 0;
  flex: none;
  /* Rot, weil dieser Haken das Gerät sperrt — die einzige Stelle im Dialog,
     an der eine Farbe etwas bedeutet. */
  accent-color: var(--danger);
}
.buchschalter small {
  display: block;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.buchzubehoer {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.buchzubehoer__liste {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.buchzubehoer__zeile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.buchhaken {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-width: 0;
  cursor: pointer;
}
.buchhaken__feld {
  width: 18px;
  height: 18px;
  flex: none;
  accent-color: var(--accent);
}
.buchhaken__text {
  min-width: 0;
}
.buchhaken__text > span {
  display: block;
}

.buchfoto {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}
.buchfoto__bild {
  max-width: 200px;
  max-height: 140px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
}
.buchfoto__auf {
  cursor: pointer;
  font-size: var(--fs-13);
}
/* Das Dateifeld selbst bleibt unsichtbar — das Label ist der Knopf. */
.buchfoto__feld {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.buchfoto__hinweis {
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

/* ── Fuß ───────────────────────────────────────────────────── */
.buchdialog__fuss {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex: none;
  padding: var(--space-4) var(--space-6);
  background: var(--surface-subtle);
  border-top: 1px solid var(--border);
}
.buchdialog__knoepfe {
  display: flex;
  gap: var(--space-2);
}
/*
 * 40 px statt der 48 px von `pt-btn`. Die Vorgabe „Daumen, teils mit
 * Handschuhen" gilt der Baustelle; am Schreibtisch zeigt eine Maus genauer.
 */
.buchdialog__fuss .pt-btn {
  min-height: 40px;
  font-size: var(--fs-14);
}

/*
 * Breit, aber mit dem Finger bedient (iPad quer): zurück auf 44 px. Darunter
 * wird ein Tippziel nicht mehr verlässlich getroffen.
 */
.buchschleier--tablet .buchdialog__fuss .pt-btn,
.buchschleier--tablet .buchneuort__knoepfe .pt-btn,
.buchschleier--tablet .buchneuort__auf,
.buchschleier--tablet .buchumschalter {
  min-height: 44px;
}
.buchschleier--tablet .buchdialog__schliessen {
  width: 44px;
  height: 44px;
}
.buchschleier--tablet .buchhaken {
  min-height: 44px;
}
.buchschleier--tablet .buchhaken__feld {
  width: 22px;
  height: 22px;
}
.buchschleier--tablet .buchschalter__feld {
  width: 24px;
  height: 24px;
}
</style>
