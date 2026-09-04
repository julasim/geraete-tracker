<script setup lang="ts">
/**
 * Die Sammelausgabe am Computer — als Spalte neben der Tabelle statt als
 * eigene Seite.
 *
 * Am Handy führt `/sammeln/:art` durch denselben Vorgang, und zwar
 * unverändert: Dort wird gescannt, hier wird angehakt. Beide arbeiten auf
 * **derselben** Sammlung im Store, also gibt es weiterhin nur einen Weg zur
 * Sammelbuchung — nur zwei Arten, sie zu füllen.
 *
 * **Alles oder nichts:** Scheitert ein Gerät, bucht der Server keines. Seine
 * Meldung nennt das Gerät beim Namen; dieses Gerät fliegt hier sofort aus der
 * Auswahl, damit der nächste Versuch nicht an derselben Stelle scheitert.
 *
 * Fest auf **Ausgabe**: Am Schreibtisch wird der Transporter bestückt. Eine
 * Sammelrücknahme oder -umbuchung entsteht dort, wo die Geräte stehen — am
 * Handy, über den Scanner.
 */
import { computed, onMounted, ref, watch } from "vue";
import { sendeSammelbuchung, type Buchungsangaben } from "@/buchen";
import { meldungAus } from "@/meldung";
import { useBestand } from "@/stores/bestand";
import { useBuchungsziel } from "@/composables/useBuchungsziel";
import { useEmpfaenger } from "@/composables/useEmpfaenger";
import { useZubehoerwahl } from "@/composables/useZubehoerwahl";
import type { Geraet } from "@/typen";
import Symbol from "./Symbol.vue";

const bestand = useBestand();

const emit = defineEmits<{
  /** Erfolgreich gebucht — mit der Anzahl der tatsächlich gebuchten Geräte. */
  gebucht: [anzahl: number];
  /** Abbrechen: die Auswahl gehört dem Store, also hebt sie der Aufrufer auf. */
  abbrechen: [];
}>();

const rueckgabe = ref("");
const notiz = ref("");

const speichert = ref(false);
const fehler = ref<string | null>(null);

const geraete = computed(() => bestand.gesammelteGeraete as Geraet[]);

/** Fest auf Ausgabe: Ins Lager zurück wird am Handy gebucht, wo die Geräte stehen. */
const { standortId, lagerplatzId, zielOrte, plaetze, merke } = useBuchungsziel(() => "ausgabe");

const {
  personen,
  empfaengerId,
  empfaengerFrei,
  fremdfirma,
  empfaengerFelder,
  laden: empfaengerLaden,
} = useEmpfaenger({
  // Wie in `SammelBuchenView` seit AP23. Bewusst nicht auf die Einzelwege
  // übertragen: `empfaenger_id` steht in einer unveränderlichen Zeile.
  ersterAlsRueckfall: true,
});

const {
  zubehoer,
  gewaehlt: zubehoerGewaehlt,
  istGewaehlt,
  umschalten: zubehoerUmschalten,
  abwaehlen: zubehoerAbwaehlen,
  laden: zubehoerLaden,
} = useZubehoerwahl(() => bestand.sammlung);

const anzahlGesamt = computed(() => geraete.value.length + zubehoerGewaehlt.value.length);

onMounted(async () => {
  await Promise.all([empfaengerLaden(), zubehoerLaden()]);
});

// Wird ein Gerät aus der Auswahl genommen, ändert sich auch sein Zubehör. Ein
// ausdrücklich abgewähltes Teil bleibt dabei abgewählt (siehe
// `useZubehoerwahl`) — hier ist der Fall am wahrscheinlichsten, weil die
// Tabelle danebensteht und zwischen zwei Klicks weitergeklickt wird.
watch(() => bestand.sammlung.length, zubehoerLaden);

/**
 * Das Gerät, das der Server in seiner Meldung beim Namen nennt, aus der
 * Auswahl nehmen.
 *
 * Der Server setzt sie als `Bezeichnung (Nummer): Grund` zusammen. Hier wird
 * deshalb nicht geraten, sondern genau dieser Anfang gegen die Auswahl
 * gehalten — passt keiner, bleibt die Auswahl unangetastet (die Meldung
 * betraf dann kein einzelnes Gerät).
 *
 * Das Abwählen läuft über `abwaehlen()`, nicht über einen Griff in die Liste
 * der Gewählten: Sonst hätte der nächste Ladevorgang das abgelehnte Teil
 * wieder angehakt, und der zweite Versuch scheiterte an derselben Stelle wie
 * der erste.
 */
function nimmGenanntesHeraus(meldung: string): void {
  const passt = (bezeichnung: string, nummer: string | null) =>
    meldung.startsWith(nummer ? `${bezeichnung} (${nummer}):` : `${bezeichnung}:`);

  const g = geraete.value.find((x) => passt(x.bezeichnung, x.inventarnummer));
  if (g) {
    bestand.entsammle(g.id);
    return;
  }

  // Auch ein Zubehörteil kann der Grund sein — dann fliegt der Haken raus.
  const z = zubehoer.value.find((x) => passt(x.bezeichnung, x.inventarnummer));
  if (z) zubehoerAbwaehlen(z.id);
}

async function buchen(): Promise<void> {
  if (speichert.value || !geraete.value.length) return;
  speichert.value = true;
  fehler.value = null;

  const angaben: Buchungsangaben = {
    art: "ausgabe",
    standortId: standortId.value,
    lagerplatzId: lagerplatzId.value,
    empfaenger: empfaengerFelder.value,
    rueckgabe: rueckgabe.value,
    notiz: notiz.value,
  };

  try {
    const antwort = await sendeSammelbuchung(
      [...bestand.sammlung, ...zubehoerGewaehlt.value],
      angaben,
    );

    // Die Zeilen in der Tabelle stehen daneben und müssen sofort stimmen.
    for (const g of antwort.geraete) bestand.ersetze(g);
    merke();
    bestand.sammlungLeeren();
    emit("gebucht", antwort.geraete.length);
  } catch (f) {
    // Wortlaut des Servers, unverändert: Er nennt das Gerät beim Namen.
    fehler.value = meldungAus(f, "Buchung fehlgeschlagen");
    nimmGenanntesHeraus(fehler.value);
  } finally {
    speichert.value = false;
  }
}
</script>

<template>
  <aside class="sammelpanel" aria-label="Sammelausgabe">
    <div class="sammelpanel__kopf">
      <p class="pt-mikro">Sammelausgabe</p>
      <h2 class="sammelpanel__titel">
        {{ anzahlGesamt }} Gerät{{ anzahlGesamt === 1 ? "" : "e" }} buchen
      </h2>
      <p class="sammelpanel__satz">
        Alles oder nichts: Scheitert ein Gerät, bucht der Server keines.
      </p>
    </div>

    <div class="sammelpanel__mitte">
      <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <div v-if="zubehoer.length" class="feldgruppe">
        <span class="pt-label">Zubehör mitnehmen</span>
        <ul class="pt-liste zubehoer">
          <li v-for="z in zubehoer" :key="z.id" class="zubehoer__zeile">
            <label class="zubehoer__haken">
              <input
                type="checkbox"
                :checked="istGewaehlt(z.id)"
                @change="zubehoerUmschalten(z.id)"
              />
              <span class="zubehoer__was">
                <span class="pt-zeile__titel">{{ z.bezeichnung }}</span>
                <span class="pt-zeile__unter pt-mono">{{ z.inventarnummer }}</span>
              </span>
            </label>
          </li>
        </ul>
      </div>

      <div class="feldgruppe">
        <label class="pt-label" for="sammel-ort">Wohin gehen die Geräte?</label>
        <select id="sammel-ort" v-model="standortId" class="pt-feld">
          <option v-for="s in zielOrte" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>

      <div v-if="plaetze.length" class="feldgruppe">
        <label class="pt-label" for="sammel-platz">Lagerplatz (falls bekannt)</label>
        <select id="sammel-platz" v-model="lagerplatzId" class="pt-feld">
          <option value="">— kein bestimmter Platz —</option>
          <option v-for="p in plaetze" :key="p.id" :value="p.id">{{ p.bezeichnung }}</option>
        </select>
      </div>

      <div class="feldgruppe">
        <label class="pt-label" for="sammel-person">Wer übernimmt sie?</label>
        <select v-if="!fremdfirma" id="sammel-person" v-model="empfaengerId" class="pt-feld">
          <option v-for="b in personen" :key="b.id" :value="b.id">{{ b.anzeigename }}</option>
        </select>
        <input
          v-else
          id="sammel-person"
          v-model="empfaengerFrei"
          class="pt-feld"
          maxlength="120"
          placeholder="Name der Firma"
        />
        <label class="nebenhaken">
          <input v-model="fremdfirma" type="checkbox" />
          Fremdfirma ohne Konto
        </label>
      </div>

      <div class="feldgruppe">
        <label class="pt-label" for="sammel-rueckgabe">Rückgabe geplant am (freiwillig)</label>
        <input id="sammel-rueckgabe" v-model="rueckgabe" type="date" class="pt-feld" />
      </div>

      <div class="feldgruppe">
        <label class="pt-label" for="sammel-notiz">Notiz (freiwillig)</label>
        <!-- 2000 Zeichen wie der Server (`notiz`). -->
        <input
          id="sammel-notiz"
          v-model="notiz"
          class="pt-feld"
          maxlength="2000"
          placeholder="Gilt für alle Geräte"
        />
      </div>
    </div>

    <div class="sammelpanel__fuss">
      <button
        class="pt-btn pt-btn--primaer pt-btn--breit"
        :disabled="speichert || !geraete.length"
        @click="buchen"
      >
        <Symbol name="haken" :groesse="16" />
        {{
          speichert ? "Wird gebucht …" : `${anzahlGesamt} Gerät${anzahlGesamt === 1 ? "" : "e"} ausgeben`
        }}
      </button>
      <button class="pt-btn pt-btn--breit" @click="emit('abbrechen')">Abbrechen</button>
    </div>
  </aside>
</template>

<style scoped>
/*
 * Die Klassen heißen `sammelpanel__*`, nicht `panel__*`: Vue vergibt das
 * scoped-Attribut der Elternkomponente auch an das Wurzelelement des Kindes,
 * und ein zweites `.panel` irgendwo in einer Ansicht griffe von außen hier
 * hinein. In diesem Projekt ist das mit `.leiste` schon einmal passiert.
 */
.sammelpanel {
  display: flex;
  flex-direction: column;
  width: 400px;
  flex: none;
  min-height: 0;
  background: var(--surface);
  border-left: 1px solid var(--border);
}

.sammelpanel__kopf {
  flex: none;
  padding: var(--space-5) var(--space-6);
  border-bottom: 1px solid var(--border);
}
.sammelpanel__titel {
  margin-top: var(--space-1);
  font-size: var(--fs-18);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
}
.sammelpanel__satz {
  margin-top: var(--space-2);
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

/*
 * Die Mitte scrollt, Kopf und Fuß nicht: Der Knopf „Geräte ausgeben" muss
 * sichtbar bleiben, auch wenn zwölf Zubehörteile im Kasten stehen.
 */
.sammelpanel__mitte {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
}

.feldgruppe {
  display: flex;
  flex-direction: column;
}

.zubehoer {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.zubehoer__zeile {
  padding: var(--space-2) var(--space-3);
}
.zubehoer__haken {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  cursor: pointer;
}
.zubehoer__was {
  min-width: 0;
}
.zubehoer__was span {
  display: block;
}

.nebenhaken {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  font-size: var(--fs-13);
  color: var(--fg-muted);
  cursor: pointer;
}

.sammelpanel__fuss {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-6);
  border-top: 1px solid var(--border);
}
</style>
