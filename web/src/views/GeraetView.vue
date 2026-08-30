<script setup lang="ts">
/**
 * Ein Gerät im Detail.
 *
 * Aufbau nach dem, was auf der Baustelle zuerst gebraucht wird:
 * Titelbild und Zustand ganz oben, darunter die Handlungen, erst danach
 * Stammdaten, Zubehör, Prüfungen, Schäden und der Verlauf.
 *
 * Der Verlauf ist eingeklappt: Er ist wichtig, wenn man ihn braucht — aber
 * er darf nicht die halbe Seite füllen, wenn man nur wissen will, wo das
 * Gerät steht.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import {
  SCHADEN_STATUS_TEXT,
  SCHWERE_TEXT,
  type Aktion,
  type Buchung,
  type Datei,
  type Geraet,
  type Pruefung,
  type Schaden,
} from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";
import DateiGalerie from "@/components/DateiGalerie.vue";

const route = useRoute();
const router = useRouter();
const anmeldung = useAnmeldung();
const bestand = useBestand();

const id = route.params.id as string;

const geraet = ref<Geraet | null>(null);
const dateien = ref<Datei[]>([]);
const historie = ref<Buchung[]>([]);

/**
 * Die Bilder, die zu einer bestimmten Buchung gehören.
 *
 * Sie stecken in derselben Liste wie die Gerätefotos — unterschieden werden
 * sie über `buchung_id`. Die Spalte gab es seit AP8, nur hing nie etwas
 * daran: Fotos ließen sich bis dahin nur am Gerät aufnehmen, nicht bei der
 * Übergabe.
 */
function fotosZurBuchung(buchungId: string): Datei[] {
  return dateien.value.filter((d) => d.buchung_id === buchungId);
}
const pruefungen = ref<Pruefung[]>([]);
const schaeden = ref<Schaden[]>([]);
const aktionen = ref<Aktion[]>([]);

const laedt = ref(true);
const fehler = ref<string | null>(null);
const verlaufOffen = ref(false);
const schadenOffen = ref(false);

const ART_TEXT: Record<string, string> = {
  ausgabe: "Ausgegeben",
  ruecknahme: "Zurückgenommen",
  umbuchung: "Umgebucht",
  korrektur: "Berichtigt",
};

const offeneSchaeden = computed(() => schaeden.value.filter((s) => s.status !== "erledigt"));

const naechstePruefung = computed(() => {
  if (!pruefungen.value.length) return null;
  return [...pruefungen.value].sort(
    (a, b) => new Date(a.naechste_faellig).getTime() - new Date(b.naechste_faellig).getTime(),
  )[0];
});

function datum(iso: string): string {
  return new Date(iso).toLocaleDateString("de-AT");
}
function zeit(iso: string): string {
  return new Date(iso).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function tageBis(iso: string): number {
  const ziel = new Date(iso);
  return Math.round((Date.UTC(ziel.getFullYear(), ziel.getMonth(), ziel.getDate()) - Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86_400_000);
}

async function laden(): Promise<void> {
  try {
    const [g, d, h, p, s] = await Promise.all([
      api.get<Geraet>(`/geraete/${id}`),
      api.get<Datei[]>(`/geraete/${id}/dateien`),
      api.get<Buchung[]>(`/geraete/${id}/historie`),
      api.get<Pruefung[]>(`/geraete/${id}/pruefungen`),
      api.get<Schaden[]>(`/geraete/${id}/schaeden`),
    ]);
    geraet.value = g;
    dateien.value = d;
    historie.value = h;
    pruefungen.value = p;
    schaeden.value = s;

    // Welche Buchungen erlaubt sind, sagt der Server — dieselbe Quelle wie
    // beim Scannen, damit Anzeige und Regelwerk nicht auseinanderlaufen.
    const gescannt = await api
      .get<{ aktionen: Aktion[] }>(`/scan/${g.inventarnummer ?? ""}`)
      .catch(() => null);
    aktionen.value = gescannt?.aktionen ?? [];
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht laden";
  } finally {
    laedt.value = false;
  }
}

// ── Schaden melden ─────────────────────────────────────────────────────────
const schadenText = ref("");
const schadenSchwere = ref<"gering" | "mittel" | "ausfall">("mittel");
const schadenLaeuft = ref(false);

async function schadenMelden(): Promise<void> {
  if (schadenLaeuft.value) return;
  schadenLaeuft.value = true;
  try {
    const antwort = await api.post<{ geraet: Geraet }>(`/geraete/${id}/schaeden`, {
      beschreibung: schadenText.value,
      schwere: schadenSchwere.value,
    });
    geraet.value = antwort.geraet;
    bestand.ersetze(antwort.geraet);
    schadenText.value = "";
    schadenOffen.value = false;
    await laden();
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht gemeldet werden";
  } finally {
    schadenLaeuft.value = false;
  }
}

async function schadenErledigen(schaden: Schaden): Promise<void> {
  const antwort = await api.patch<{ geraet: Geraet }>(`/schaeden/${schaden.id}`, {
    status: "erledigt",
  });
  geraet.value = antwort.geraet;
  bestand.ersetze(antwort.geraet);
  await laden();
}

onMounted(laden);
</script>

<template>
  <div>
    <Kopf :titel="geraet?.bezeichnung ?? 'Gerät'" zurueck :unter="geraet?.inventarnummer ?? ''" />

    <div class="inhalt">
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>
      <p v-else-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <template v-else-if="geraet">
        <!-- ── Titelbild und Zustand ─────────────────────── -->
        <div class="pt-karte kopfkarte">
          <img
            v-if="geraet.titelbild_id"
            class="kopfkarte__bild"
            :src="`/api/dateien/${geraet.titelbild_id}`"
            :alt="geraet.bezeichnung"
          />

          <div class="kopfkarte__text">
            <div class="marken">
              <StatusChip :status="geraet.status" gross />
              <span v-if="offeneSchaeden.length" class="pt-chip pt-chip--defekt">
                {{ offeneSchaeden.length }} offen{{ offeneSchaeden.length === 1 ? "er" : "e" }} Schaden
              </span>
              <span
                v-if="naechstePruefung && tageBis(naechstePruefung.naechste_faellig) < 0"
                class="pt-chip pt-chip--defekt"
              >
                Prüfung überfällig
              </span>
            </div>

            <!-- Wo ist es gerade — die häufigste Frage, in einem Satz. -->
            <p class="satz">
              <template v-if="geraet.status === 'ausgegeben'">
                Steht auf <strong>{{ geraet.standort ?? "unbekannt" }}</strong
                ><template v-if="geraet.nutzer">, bei <strong>{{ geraet.nutzer }}</strong></template
                >.
              </template>
              <template v-else-if="geraet.lagerplatz">
                Liegt in <strong>{{ geraet.lagerplatz }}</strong> ({{ geraet.standort }}).
              </template>
              <template v-else-if="geraet.standort">
                Steht im <strong>{{ geraet.standort }}</strong
                >.
              </template>
              <template v-else>Kein Standort hinterlegt.</template>
            </p>

            <div v-if="geraet.schlagworte.length" class="worte">
              <span
                v-for="w in geraet.schlagworte"
                :key="w.id"
                class="pt-chip pt-chip--neutral"
                :style="w.farbe ? { borderColor: w.farbe, color: w.farbe } : undefined"
              >
                {{ w.name }}
              </span>
            </div>
          </div>
        </div>

        <!-- ── Handlungen ────────────────────────────────── -->
        <div class="aktionen">
          <button
            v-for="a in aktionen"
            :key="a.art"
            class="pt-btn pt-btn--breit"
            :class="a.hauptaktion ? 'pt-btn--primaer pt-btn--gross' : ''"
            @click="router.push(`/buchen/${geraet.id}/${a.art}`)"
          >
            {{ a.text }}
          </button>
          <button class="pt-btn pt-btn--breit" @click="schadenOffen = !schadenOffen">
            <Symbol name="warnung" :groesse="18" />
            Schaden melden
          </button>
        </div>

        <!-- ── Schaden melden ────────────────────────────── -->
        <div v-if="schadenOffen" class="pt-karte formular">
          <label class="pt-label" for="schaden">Was ist mit dem Gerät?</label>
          <input
            id="schaden"
            v-model="schadenText"
            class="pt-feld"
            type="text"
            placeholder="z. B. Motor läuft unrund"
          />

          <label class="pt-label" for="schwere">Wie schlimm?</label>
          <select id="schwere" v-model="schadenSchwere" class="pt-feld">
            <option value="gering">Gering — lässt sich weiter benutzen</option>
            <option value="mittel">Mittel — eingeschränkt benutzbar</option>
            <option value="ausfall">Ausfall — sperrt das Gerät sofort</option>
          </select>

          <button
            class="pt-btn pt-btn--primaer pt-btn--breit"
            :disabled="schadenText.trim().length < 3 || schadenLaeuft"
            @click="schadenMelden"
          >
            Schaden melden
          </button>
        </div>

        <!-- ── Fotos und Dokumente ───────────────────────── -->
        <DateiGalerie :geraet-id="geraet.id" :dateien="dateien" @geaendert="laden" />

        <!-- ── Zubehör ───────────────────────────────────── -->
        <section v-if="geraet.zubehoer.length || geraet.gehoert_zu">
          <h2 class="pt-mikro abschnitt">Zubehör</h2>

          <p v-if="geraet.gehoert_zu" class="pt-meldung pt-meldung--hinweis">
            Gehört zu <strong>{{ geraet.gehoert_zu }}</strong
            >.
            <RouterLink v-if="geraet.gehoert_zu_id" :to="`/geraete/${geraet.gehoert_zu_id}`">
              Ansehen
            </RouterLink>
          </p>

          <ul v-if="geraet.zubehoer.length" class="pt-karte pt-liste">
            <li v-for="z in geraet.zubehoer" :key="z.id">
              <RouterLink :to="`/geraete/${z.id}`" class="pt-zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ z.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">{{ z.inventarnummer }}</div>
                </div>
                <StatusChip :status="z.status" />
              </RouterLink>
            </li>
          </ul>
        </section>

        <!-- ── Stammdaten ────────────────────────────────── -->
        <section>
          <h2 class="pt-mikro abschnitt">Stammdaten</h2>
          <dl class="pt-karte daten">
            <template v-if="geraet.hersteller">
              <dt>Hersteller</dt>
              <dd>{{ geraet.hersteller }}</dd>
            </template>
            <template v-if="geraet.modell">
              <dt>Modell</dt>
              <dd>{{ geraet.modell }}</dd>
            </template>
            <template v-if="geraet.seriennummer">
              <dt>Seriennummer</dt>
              <dd class="pt-mono">{{ geraet.seriennummer }}</dd>
            </template>
            <template v-if="geraet.betriebsstunden">
              <dt>Betriebsstunden</dt>
              <dd class="pt-mono">{{ geraet.betriebsstunden }} h</dd>
            </template>
            <template v-if="geraet.anschaffungsdatum">
              <dt>Angeschafft</dt>
              <dd>{{ datum(geraet.anschaffungsdatum) }}</dd>
            </template>
            <template v-if="geraet.notiz">
              <dt>Notiz</dt>
              <dd>{{ geraet.notiz }}</dd>
            </template>
          </dl>
        </section>

        <!-- ── Prüfungen ─────────────────────────────────── -->
        <section v-if="pruefungen.length">
          <h2 class="pt-mikro abschnitt">Prüfungen</h2>
          <ul class="pt-karte pt-liste">
            <li v-for="p in pruefungen.slice(0, 5)" :key="p.id">
              <div class="pt-zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ p.pruefart }}</div>
                  <div class="pt-zeile__unter">
                    geprüft {{ datum(p.geprueft_am) }} · nächste {{ datum(p.naechste_faellig) }}
                  </div>
                </div>
                <span
                  class="pt-chip"
                  :class="
                    tageBis(p.naechste_faellig) < 0
                      ? 'pt-chip--defekt'
                      : tageBis(p.naechste_faellig) < 30
                        ? 'pt-chip--wartung'
                        : 'pt-chip--verfuegbar'
                  "
                >
                  {{
                    tageBis(p.naechste_faellig) < 0
                      ? `${-tageBis(p.naechste_faellig)} T überfällig`
                      : `in ${tageBis(p.naechste_faellig)} T`
                  }}
                </span>
              </div>
            </li>
          </ul>
        </section>

        <!-- ── Schäden ───────────────────────────────────── -->
        <section v-if="schaeden.length">
          <h2 class="pt-mikro abschnitt">Schäden</h2>
          <ul class="pt-karte pt-liste">
            <li v-for="s in schaeden" :key="s.id">
              <div class="schaden">
                <div class="schaden__kopf">
                  <span class="pt-chip" :class="s.status === 'erledigt' ? 'pt-chip--neutral' : 'pt-chip--defekt'">
                    {{ SCHADEN_STATUS_TEXT[s.status] }}
                  </span>
                  <span class="pt-gedaempft">{{ SCHWERE_TEXT[s.schwere] }}</span>
                  <span class="pt-gedaempft">{{ zeit(s.gemeldet_am) }}</span>
                </div>
                <p class="schaden__text">{{ s.beschreibung }}</p>
                <p class="pt-gedaempft schaden__wer">gemeldet von {{ s.gemeldet_von_name }}</p>
                <button
                  v-if="anmeldung.darf('schaeden.bearbeiten') && s.status !== 'erledigt'"
                  class="pt-btn schaden__knopf"
                  @click="schadenErledigen(s)"
                >
                  Als erledigt eintragen
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- ── Verlauf ───────────────────────────────────── -->
        <section>
          <button class="aufklapper" :aria-expanded="verlaufOffen" @click="verlaufOffen = !verlaufOffen">
            <h2 class="pt-mikro">Verlauf ({{ historie.length }})</h2>
            <span class="aufklapper__zeichen">{{ verlaufOffen ? "−" : "+" }}</span>
          </button>

          <template v-if="verlaufOffen">
            <p v-if="!historie.length" class="pt-leer">Noch keine Buchung.</p>
            <ol v-else class="verlauf">
              <li v-for="b in historie" :key="b.id" class="verlauf__eintrag">
                <div class="verlauf__punkt" aria-hidden="true"></div>
                <div class="verlauf__text">
                  <div class="verlauf__kopf">
                    <strong>{{ ART_TEXT[b.art] ?? b.art }}</strong>
                    <span class="pt-gedaempft">{{ zeit(b.zeitpunkt) }}</span>
                  </div>
                  <div class="pt-gedaempft verlauf__zeile">
                    <template v-if="b.nach_standort">→ {{ b.nach_standort }}</template>
                    <template v-if="b.nach_lagerplatz"> · {{ b.nach_lagerplatz }}</template>
                    <template v-if="b.empfaenger"> · an {{ b.empfaenger }}</template>
                  </div>
                  <div class="pt-gedaempft verlauf__zeile">erfasst von {{ b.erfasser }}</div>
                  <p v-if="b.notiz" class="verlauf__notiz">{{ b.notiz }}</p>

                  <!--
                    Fotos, die bei DIESER Buchung entstanden sind. Sie
                    belegen den Zustand bei der Übergabe — genau der Punkt,
                    an dem sich später streiten lässt, wie ein Gerät
                    hinausging.
                  -->
                  <div v-if="fotosZurBuchung(b.id).length" class="verlauf__fotos">
                    <a
                      v-for="d in fotosZurBuchung(b.id)"
                      :key="d.id"
                      :href="`/api/dateien/${d.id}`"
                      target="_blank"
                      rel="noopener"
                    >
                      <img
                        :src="`/api/dateien/${d.id}`"
                        :alt="`Zustand bei der Buchung vom ${zeit(b.zeitpunkt)}`"
                        class="verlauf__foto"
                        loading="lazy"
                      />
                    </a>
                  </div>
                </div>
              </li>
            </ol>
          </template>
        </section>

        <button
          v-if="anmeldung.darf('geraete.pflegen')"
          class="pt-btn pt-btn--breit"
          @click="router.push(`/geraete/${geraet.id}/bearbeiten`)"
        >
          Stammdaten bearbeiten
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.inhalt {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.kopfkarte {
  overflow: hidden;
}
.kopfkarte__bild {
  width: 100%;
  max-height: 220px;
  object-fit: cover;
  display: block;
  border-bottom: 1px solid var(--border);
}
.kopfkarte__text {
  padding: var(--space-4);
}

.marken {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.satz {
  font-size: var(--fs-15);
}
.satz strong {
  font-weight: var(--fw-semibold);
  color: var(--fg);
}

.worte {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.aktionen {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.formular {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
}

.abschnitt {
  margin-bottom: var(--space-2);
}

.daten {
  display: grid;
  grid-template-columns: minmax(110px, auto) 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  padding: var(--space-4);
  font-size: var(--fs-14);
}
.daten dt {
  color: var(--fg-muted);
}
.daten dd {
  margin: 0;
  color: var(--fg-body);
}

.schaden {
  padding: var(--space-3) var(--space-4);
}
.schaden__kopf {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-12);
  margin-bottom: var(--space-2);
}
.schaden__text {
  font-size: var(--fs-14);
}
.schaden__wer {
  font-size: var(--fs-12);
  margin-top: var(--space-1);
}
.schaden__knopf {
  margin-top: var(--space-2);
  min-height: 40px;
  font-size: var(--fs-13);
}

/* ── Aufklappbarer Verlauf ──────────────────────────────── */
.aufklapper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: var(--tippziel);
  padding: 0;
  background: none;
  border: 0;
  cursor: pointer;
}
.aufklapper__zeichen {
  font-size: var(--fs-20);
  color: var(--fg-muted);
}

.verlauf {
  list-style: none;
  margin: 0;
  padding: 0;
}
.verlauf__eintrag {
  position: relative;
  display: flex;
  gap: var(--space-3);
  padding: var(--space-3) 0;
}
.verlauf__eintrag:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 4px;
  top: 22px;
  bottom: -6px;
  width: 1px;
  background: var(--border);
}
.verlauf__punkt {
  flex: none;
  width: 9px;
  height: 9px;
  margin-top: 6px;
  background: var(--fg-subtle);
  border-radius: var(--radius-full);
}
.verlauf__eintrag:first-child .verlauf__punkt {
  background: var(--fg);
}
.verlauf__text {
  flex: 1;
  min-width: 0;
  font-size: var(--fs-14);
}
.verlauf__kopf {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: space-between;
}
.verlauf__zeile {
  font-size: var(--fs-13);
}
.verlauf__notiz {
  margin-top: var(--space-1);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-13);
  background: var(--surface-muted);
  border-radius: var(--radius-md);
}
.verlauf__fotos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.verlauf__foto {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
</style>
