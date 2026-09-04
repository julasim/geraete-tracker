<script setup lang="ts">
/**
 * Mehrere Geräte in einem Vorgang buchen.
 *
 * Der Fall aus dem Bauhof: Zehn Geräte gehen auf dieselbe Baustelle. Einzeln
 * gebucht sind das dreißig Handgriffe.
 *
 * **Zubehör wird vorgeschlagen, nicht erzwungen.** Wer den Bagger ausgibt,
 * lädt die Löffel mit auf — ohne diesen Vorschlag stünden sie im System
 * weiter im Lager, und der Bestand wäre falsch. Manchmal bleibt der Löffel
 * aber da, deshalb ist jeder Haken abwählbar.
 *
 * **Alles oder nichts:** Scheitert ein Gerät, bucht der Server keines. Die
 * Meldung nennt es beim Namen, es wird aus der Liste genommen, und der Rest
 * geht durch. Eine halb ausgeführte Sammelbuchung hinterließe einen Bestand,
 * den niemand mehr erklären kann.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { sendeSammelbuchung, type Buchungsangaben } from "@/buchen";
import { meldungAus } from "@/meldung";
import { useBestand } from "@/stores/bestand";
import { useBuchungsziel } from "@/composables/useBuchungsziel";
import { useEmpfaenger } from "@/composables/useEmpfaenger";
import { useZubehoerwahl } from "@/composables/useZubehoerwahl";
import type { Buchungsart, Geraet, Standort } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";

const route = useRoute();
const router = useRouter();
const bestand = useBestand();

const art = route.params.art as Buchungsart;
const istRuecknahme = computed(() => art === "ruecknahme");

const rueckgabe = ref("");
const notiz = ref("");

const speichert = ref(false);
const fehler = ref<string | null>(null);
const fertig = ref(false);
const gebucht = ref(0);

const geraete = computed(() => bestand.gesammelteGeraete as Geraet[]);

const { standortId, lagerplatzId, zielOrte, plaetze, merke } = useBuchungsziel(() => art);

const {
  personen,
  empfaengerId,
  empfaengerFrei,
  fremdfirma,
  empfaengerFelder,
  laden: empfaengerLaden,
} = useEmpfaenger({
  // Bei einer Rücknahme gibt es kein Empfängerfeld — dann braucht es die
  // Namensliste auch nicht. Diese Bedingung stand hier schon vor AP25 und
  // darf beim Zusammenführen nicht stillschweigend verschwinden.
  wenn: () => !istRuecknahme.value,
  // Der Rückfall auf den ersten Namen stammt aus AP23 und bleibt auf die
  // Sammelwege beschränkt: `empfaenger_id` landet in einer unveränderlichen
  // Zeile, ein fremder Name darin ist nur per Gegenbuchung zu berichtigen.
  ersterAlsRueckfall: true,
});

const {
  zubehoer,
  gewaehlt: zubehoerGewaehlt,
  istGewaehlt,
  umschalten: zubehoerUmschalten,
  laden: zubehoerLaden,
} = useZubehoerwahl(
  () => bestand.sammlung,
  () => art,
);

const anzahlGesamt = computed(() => geraete.value.length + zubehoerGewaehlt.value.length);

onMounted(async () => {
  await bestand.laden();
  await Promise.all([empfaengerLaden(), zubehoerLaden()]);
});

// Wird ein Gerät aus der Liste genommen, ändert sich auch sein Zubehör. Die
// ausdrücklich abgewählten Teile überstehen das seit AP25 (siehe
// `useZubehoerwahl`) — vorher hakte sich der abgewählte Hammer hier wieder an.
watch(() => bestand.sammlung.length, zubehoerLaden);

async function buchen(): Promise<void> {
  if (speichert.value || !geraete.value.length) return;
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
    const antwort = await sendeSammelbuchung(
      [...bestand.sammlung, ...zubehoerGewaehlt.value],
      angaben,
    );

    for (const g of antwort.geraete) bestand.ersetze(g);
    merke();
    gebucht.value = antwort.geraete.length;
    bestand.sammlungLeeren();
    fertig.value = true;
  } catch (f) {
    // Der Server nennt das Gerät beim Namen ("Rüttelplatte (10011): …").
    // Genau diese Meldung gehört hierher, damit klar ist, welches Gerät aus
    // der Liste muss.
    fehler.value = meldungAus(f, "Buchung fehlgeschlagen");
  } finally {
    speichert.value = false;
  }
}

const TITEL: Record<string, string> = {
  ausgabe: "Sammelausgabe",
  ruecknahme: "Sammelrücknahme",
  umbuchung: "Sammelumbuchung",
};
const ZIEL_FRAGE: Record<string, string> = {
  ausgabe: "Wohin gehen die Geräte?",
  ruecknahme: "Zurück ins Lager",
  umbuchung: "Wohin werden sie umgebucht?",
};

function ortAlsText(s: Standort): string {
  return s.name;
}
</script>

<template>
  <div>
    <Kopf
      :titel="TITEL[art] ?? 'Sammelbuchung'"
      :unter="fertig ? '' : `${anzahlGesamt} Gerät${anzahlGesamt === 1 ? '' : 'e'}`"
    />

    <template v-if="fertig">
      <div class="fertig">
        <div class="fertig__haken"><Symbol name="haken" :groesse="40" /></div>
        <!--
          Die Mehrzahl wird gebeugt. Das ist keine Kosmetik, sondern das
          Musterbeispiel dieser Runde: In `SammelPanel` wurde genau dieser
          Fehler bei AP24 behoben — und die wortgleiche Stelle am Handy blieb
          stehen, weil niemand wusste, dass es sie ein zweites Mal gibt.
        -->
        <h2 class="fertig__titel">{{ gebucht }} Gerät{{ gebucht === 1 ? "" : "e" }} gebucht</h2>
        <p class="fertig__satz">
          {{ art === "ausgabe" ? "Ausgegeben" : art === "ruecknahme" ? "Zurückgenommen" : "Umgebucht" }}
        </p>
      </div>
      <div class="knoepfe">
        <button
          class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
          @click="router.push('/scan')"
        >
          <Symbol name="scan" :groesse="20" />
          Weiter scannen
        </button>
      </div>
    </template>

    <template v-else-if="!geraete.length">
      <p class="pt-leer">
        Keine Geräte gesammelt. Zurück zum Scanner und die Geräte einlesen.
      </p>
      <div class="knoepfe">
        <button class="pt-btn pt-btn--breit" @click="router.push('/scan')">Zum Scanner</button>
      </div>
    </template>

    <template v-else>
      <div class="inhalt">
        <!-- ── Die gesammelten Geräte ────────────────────── -->
        <ul class="pt-liste karte">
          <li v-for="g in geraete" :key="g.id" class="zeile">
            <div class="pt-zeile__haupt">
              <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
              <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
            </div>
            <StatusChip :status="g.status" />
            <button class="pt-btn pt-btn--still kleinknopf" @click="bestand.entsammle(g.id)">
              Entfernen
            </button>
          </li>
        </ul>

        <!-- ── Zubehör ───────────────────────────────────── -->
        <div v-if="zubehoer.length" class="feldgruppe">
          <span class="pt-label">Zubehör mitnehmen</span>
          <p class="pt-gedaempft hinweis">
            Gehört zu den gewählten Geräten. Was dableibt, hier abwählen.
          </p>
          <ul class="pt-liste karte">
            <li v-for="z in zubehoer" :key="z.id" class="zeile">
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

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <div class="feldgruppe">
          <label class="pt-label" for="ort">{{ ZIEL_FRAGE[art] }}</label>
          <select id="ort" v-model="standortId" class="pt-feld">
            <option v-for="s in zielOrte" :key="s.id" :value="s.id">{{ ortAlsText(s) }}</option>
          </select>
        </div>

        <div v-if="plaetze.length" class="feldgruppe">
          <label class="pt-label" for="platz">Lagerplatz (falls bekannt)</label>
          <select id="platz" v-model="lagerplatzId" class="pt-feld">
            <option value="">— kein bestimmter Platz —</option>
            <option v-for="p in plaetze" :key="p.id" :value="p.id">{{ p.bezeichnung }}</option>
          </select>
        </div>

        <template v-if="!istRuecknahme">
          <div class="feldgruppe">
            <label class="pt-label" for="person">Wer übernimmt sie?</label>
            <select v-if="!fremdfirma" id="person" v-model="empfaengerId" class="pt-feld">
              <option v-for="b in personen" :key="b.id" :value="b.id">{{ b.anzeigename }}</option>
            </select>
            <input
              v-else
              id="person"
              v-model="empfaengerFrei"
              class="pt-feld"
              maxlength="120"
              placeholder="Name der Firma"
            />
            <label class="haken haken--klein">
              <input v-model="fremdfirma" type="checkbox" class="haken__feld" />
              <span>Fremdfirma ohne Konto</span>
            </label>
          </div>

          <div class="feldgruppe">
            <label class="pt-label" for="rueckgabe">Rückgabe geplant am (freiwillig)</label>
            <input id="rueckgabe" v-model="rueckgabe" type="date" class="pt-feld" />
          </div>
        </template>

        <div class="feldgruppe">
          <label class="pt-label" for="notiz">Notiz (freiwillig)</label>
          <!-- 2000 Zeichen wie der Server (`notiz`). -->
          <input
            id="notiz"
            v-model="notiz"
            class="pt-feld"
            maxlength="2000"
            placeholder="Gilt für alle Geräte"
          />
        </div>

        <div class="knoepfe">
          <button
            class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
            :disabled="speichert"
            @click="buchen"
          >
            {{
              speichert
                ? "Wird gebucht …"
                : `${anzahlGesamt} Gerät${anzahlGesamt === 1 ? "" : "e"} buchen`
            }}
          </button>
          <button class="pt-btn pt-btn--breit" @click="router.push('/scan')">Abbrechen</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.inhalt {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-5);
}
.karte {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.zeile {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
}
.feldgruppe {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.hinweis {
  font-size: var(--fs-13);
  margin-bottom: var(--space-1);
}
.haken {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 1;
  min-height: 48px;
  cursor: pointer;
}
.haken--klein {
  min-height: 40px;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.haken__feld {
  width: 22px;
  height: 22px;
  flex: none;
}
.haken span span {
  display: block;
}
.kleinknopf {
  font-size: var(--fs-12);
  padding: var(--space-1) var(--space-2);
}
.knoepfe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: 0 var(--space-4) var(--space-4);
}
.fertig {
  text-align: center;
  padding: var(--space-6) var(--space-4);
}
.fertig__haken {
  display: flex;
  justify-content: center;
  margin-bottom: var(--space-3);
}
.fertig__titel {
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
}
.fertig__satz {
  color: var(--fg-muted);
  margin-top: var(--space-2);
}
</style>
