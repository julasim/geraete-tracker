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
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Buchungsart, Geraet, PaketGeraet, Standort } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";

const route = useRoute();
const router = useRouter();
const bestand = useBestand();
const anmeldung = useAnmeldung();

const art = route.params.art as Buchungsart;
const istRuecknahme = computed(() => art === "ruecknahme");

const LETZTER_ORT = "gt-letzter-ort";

const personen = ref<{ id: string; anzeigename: string }[]>([]);
const standortId = ref("");
const lagerplatzId = ref("");
const empfaengerId = ref("");
const empfaengerFrei = ref("");
const fremdfirma = ref(false);
const rueckgabe = ref("");
const notiz = ref("");

const speichert = ref(false);
const fehler = ref<string | null>(null);
const fertig = ref(false);
const gebucht = ref(0);

const geraete = computed(() => bestand.gesammelteGeraete as Geraet[]);

const zielOrte = computed(() =>
  istRuecknahme.value ? bestand.lager : bestand.aktiveStandorte.filter((s) => s.typ !== "lager"),
);
const plaetze = computed(() =>
  standortId.value ? bestand.plaetzeAmStandort(standortId.value) : [],
);

// ── Zubehör ────────────────────────────────────────────────────────────────

const zubehoer = ref<PaketGeraet[]>([]);
const zubehoerGewaehlt = ref<string[]>([]);

async function zubehoerLaden(): Promise<void> {
  const ids = bestand.sammlung;
  if (!ids.length) {
    zubehoer.value = [];
    return;
  }
  try {
    // Je Gerät einzeln: Es sind wenige Aufrufe, sie laufen parallel, und die
    // Route gibt es bereits. Eine Sammelroute dafür wäre mehr Schnittstelle
    // als Gewinn.
    const listen = await Promise.all(
      ids.map((id) => api.get<PaketGeraet[]>(`/geraete/${id}/zubehoer`).catch(() => [])),
    );
    // Was selbst schon gesammelt ist, nicht doppelt anbieten.
    const gesehen = new Set(ids);
    const flach: PaketGeraet[] = [];
    for (const z of listen.flat()) {
      if (gesehen.has(z.id)) continue;
      gesehen.add(z.id);
      flach.push(z);
    }
    zubehoer.value = flach;
    // Vorangehakt: Der Regelfall ist, dass das Zubehör mitfährt.
    zubehoerGewaehlt.value = flach.map((z) => z.id);
  } catch {
    zubehoer.value = [];
  }
}

function zubehoerUmschalten(id: string): void {
  const i = zubehoerGewaehlt.value.indexOf(id);
  if (i >= 0) zubehoerGewaehlt.value.splice(i, 1);
  else zubehoerGewaehlt.value.push(id);
}

const anzahlGesamt = computed(() => geraete.value.length + zubehoerGewaehlt.value.length);

onMounted(async () => {
  await bestand.laden();
  const gemerkt = localStorage.getItem(`${LETZTER_ORT}-${art}`);
  const passt = gemerkt && zielOrte.value.some((s) => s.id === gemerkt);
  standortId.value = passt && gemerkt ? gemerkt : (zielOrte.value[0]?.id ?? "");

  if (!istRuecknahme.value) {
    try {
      personen.value = await api.get<{ id: string; anzeigename: string }[]>("/benutzer");
      empfaengerId.value = anmeldung.benutzer?.id ?? personen.value[0]?.id ?? "";
    } catch {
      // Ohne Personenliste bleibt der Freitext — buchen muss trotzdem gehen.
    }
  }
  await zubehoerLaden();
});

// Wird ein Gerät aus der Liste genommen, ändert sich auch sein Zubehör.
watch(() => bestand.sammlung.length, zubehoerLaden);

async function buchen(): Promise<void> {
  if (speichert.value || !geraete.value.length) return;
  speichert.value = true;
  fehler.value = null;

  const alle = [...bestand.sammlung, ...zubehoerGewaehlt.value];
  try {
    const antwort = await api.post<{ geraete: Geraet[] }>("/buchungen/sammel", {
      geraet_ids: alle,
      art,
      nach_standort_id: standortId.value || null,
      nach_lagerplatz_id: lagerplatzId.value || null,
      empfaenger_id: fremdfirma.value ? null : empfaengerId.value || null,
      empfaenger_freitext: fremdfirma.value ? empfaengerFrei.value : null,
      geplante_rueckgabe: rueckgabe.value || null,
      notiz: notiz.value || null,
    });

    for (const g of antwort.geraete) bestand.ersetze(g);
    localStorage.setItem(`${LETZTER_ORT}-${art}`, standortId.value);
    gebucht.value = antwort.geraete.length;
    bestand.sammlungLeeren();
    fertig.value = true;
  } catch (f) {
    // Der Server nennt das Gerät beim Namen ("Rüttelplatte (10011): …").
    // Genau diese Meldung gehört hierher, damit klar ist, welches Gerät aus
    // der Liste muss.
    fehler.value =
      f instanceof ApiError ? f.message : f instanceof Error ? f.message : "Buchung fehlgeschlagen";
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
        <h2 class="fertig__titel">{{ gebucht }} Geräte gebucht</h2>
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
                  :checked="zubehoerGewaehlt.includes(z.id)"
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
          <input id="notiz" v-model="notiz" class="pt-feld" placeholder="Gilt für alle Geräte" />
        </div>

        <div class="knoepfe">
          <button
            class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
            :disabled="speichert"
            @click="buchen"
          >
            {{ speichert ? "Wird gebucht …" : `${anzahlGesamt} Geräte buchen` }}
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
