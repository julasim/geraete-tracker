<script setup lang="ts">
/**
 * Ein Gerät im Detail — in zwei Haltungen.
 *
 * **Am Handy** (unter 1024 px) steht alles untereinander, in der Reihenfolge,
 * die auf der Baustelle zählt: Titelbild und Zustand ganz oben, darunter die
 * Handlungen, erst danach Stammdaten, Zubehör, Prüfungen, Schäden und der
 * Verlauf. Der Verlauf ist dort eingeklappt — er ist wichtig, wenn man ihn
 * braucht, darf aber nicht die halbe Seite füllen, wenn man nur wissen will,
 * wo das Gerät steht.
 *
 * **Am Computer** (ab 1024 px) liegt derselbe Inhalt zweispaltig: links der
 * Standortsatz und der volle Verlauf, rechts Bilder, Stammdaten und
 * Prüfungen. Die Handlungen wandern in die Kopfzeile, wo sie am Schreibtisch
 * hingehören — als volle Knopfreihe im Inhalt wären sie das Lauteste auf
 * einer Seite, auf der man meistens nur nachsieht.
 *
 * **Der Verlauf ist am Computer offen.** Das ist keine Einstellung, sondern
 * eine Folge der Haltung: Am Schreibtisch sucht man die Historie, am Handy
 * den Standort. Deshalb gibt es hier auch keinen Aufklapper, der beides kann.
 *
 * Die beiden Zweige stehen bewusst nebeneinander im Template statt in einer
 * Reihe von Sonderregeln: Sie unterscheiden sich in fast jedem Maß, und ein
 * gemeinsames Gerüst mit zwölf Ausnahmen wäre schwerer zu lesen als zwei
 * Aufbauten. Die Logik darunter — Laden, Schaden melden, Fristen, Zeitpunkte
 * — teilen sie sich vollständig.
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { ampelKlasse, frist } from "@/format";
import { useBreite } from "@/composables/useBreite";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import {
  SCHADEN_STATUS_TEXT,
  SCHWERE_TEXT,
  type Aktion,
  type Ampel,
  type Buchung,
  type Buchungsart,
  type Datei,
  type Geraet,
  type Pruefart,
  type Pruefung,
  type Schaden,
} from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";
import Symbol from "@/components/Symbol.vue";
import TopLeiste from "@/components/TopLeiste.vue";
import DateiGalerie from "@/components/DateiGalerie.vue";
import BuchenDialog from "@/components/BuchenDialog.vue";

const route = useRoute();
const router = useRouter();
const anmeldung = useAnmeldung();
const bestand = useBestand();
const { breit } = useBreite();

const id = computed(() => route.params.id as string);

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

/**
 * Wie dringend ist diese Prüfung?
 *
 * Dieselben Schwellen wie `src/domain/pruefung.ts` auf dem Server (0 / 14 /
 * 60 Tage). Sie stehen hier ein zweites Mal, weil Serverdomäne und
 * Oberfläche kein Modul teilen — dann aber wenigstens mit denselben Zahlen:
 * Ein Gerät, das die Fristenliste rot zeigt, muss auch in seiner eigenen
 * Ansicht rot sein. Die Farbe selbst kommt aus `ampelKlasse()`.
 */
function ampelVon(iso: string): Ampel {
  const tage = tageBis(iso);
  if (tage < 0) return "ueberfaellig";
  if (tage <= 14) return "faellig";
  if (tage <= 60) return "bald";
  return "ok";
}

/**
 * Die Warnung über der Schlagwortreihe — nur, wenn die Prüfung wirklich
 * abgelaufen ist. Eine Warnung, die immer steht, wird nicht mehr gelesen.
 */
const pruefwarnung = computed(() => {
  const p = naechstePruefung.value;
  if (!p) return null;
  const tage = tageBis(p.naechste_faellig);
  if (tage >= 0) return null;
  return `Prüfung überfällig — ${p.pruefart}, ${frist(tage)}`;
});

/**
 * Welche Buchungen darf dieser Benutzer anstoßen?
 *
 * **Der Inhalt kommt ausschließlich vom Server** (`GET /scan/:nummer` →
 * `aktionen`) — hier wird nur noch das Recht davorgehängt. Eine im Frontend
 * erfundene Aktion liefe dem Zustandsautomaten davon: Der Benutzer tippt auf
 * „Ausgeben" und erfährt erst danach, dass das Gerät gesperrt ist.
 *
 * **Beide Haltungen lesen diese computed.** Der Handy-Zweig nahm bis AP25
 * das rohe Ref daneben und zeigte die Knöpfe damit auch ohne
 * `buchungen.erfassen` — sichtbar wurde das nie, weil die Rechte-Tests
 * ausschließlich die breite Haltung bauten.
 *
 * Die Prüfung bleibt hier stehen, auch wenn der Server die Liste künftig
 * selbst nach Rechten filtert: Zwei Schranken kosten nichts, und eine
 * Aktion, die trotzdem durchkommt, wäre sonst sofort ein Knopf.
 */
const erlaubteAktionen = computed(() =>
  anmeldung.darf("buchungen.erfassen") ? aktionen.value : [],
);

/**
 * Eine erlaubte Buchung anstoßen.
 *
 * **Am Computer als Dialog über dieser Ansicht**, am Handy weiterhin als
 * eigene Seite. Das ist keine Geschmacksfrage: Auf 390 px hat ein Dialog von
 * 560 px keinen Platz, und die Handy-Buchung endet bewusst auf einer eigenen
 * Bestätigungsseite, die man mit Handschuhen lesen kann. Am Schreibtisch
 * wäre ein Seitenwechsel dagegen ein Verlust — die Liste dahinter bleibt
 * stehen, und nach dem Buchen ist man wieder da, wo man war.
 */
const dialogArt = ref<Buchungsart | null>(null);
/** Kurze Rückmeldung nach einer Buchung; die eigene Seite entfällt hier. */
const gebuchtMeldung = ref("");

function buchen(art: Buchungsart): void {
  if (breit.value && geraet.value) {
    dialogArt.value = art;
    return;
  }
  router.push(`/buchen/${id.value}/${art}`);
}

/**
 * Nach dem Buchen neu laden statt den Datensatz von Hand nachzuziehen.
 *
 * Status, Standort und die erlaubten Handlungen ergeben sich alle aus
 * Buchungen und kommen alle vom Server — sie hier zusammenzurechnen hieße,
 * eine zweite Wahrheit zu führen, die beim ersten Sonderfall abweicht.
 */
async function nachDerBuchung(): Promise<void> {
  dialogArt.value = null;
  gebuchtMeldung.value = "Gebucht.";
  await laden();
}

async function laden(): Promise<void> {
  try {
    const aktuelleId = id.value;
    const [gMitAktionen, d, h, p, s] = await Promise.all([
      api.get<Geraet & { aktionen: Aktion[] }>(`/geraete/${aktuelleId}`),
      api.get<Datei[]>(`/geraete/${aktuelleId}/dateien`),
      api.get<Buchung[]>(`/geraete/${aktuelleId}/historie`),
      api.get<Pruefung[]>(`/geraete/${aktuelleId}/pruefungen`),
      api.get<Schaden[]>(`/geraete/${aktuelleId}/schaeden`),
    ]);
    const { aktionen: serverAktionen, ...g } = gMitAktionen;
    geraet.value = g;
    dateien.value = d;
    historie.value = h;
    pruefungen.value = p;
    schaeden.value = s;
    aktionen.value = serverAktionen;
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
    const antwort = await api.post<{ geraet: Geraet }>(`/geraete/${id.value}/schaeden`, {
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

// ── Prüfung eintragen ─────────────────────────────────────────────────────
const pruefungOffen = ref(false);
const pruefarten = ref<Pruefart[]>([]);
const pruefartId = ref("");
const geprueftAm = ref(new Date().toISOString().slice(0, 10));
const pruefErgebnis = ref<"bestanden" | "maengel" | "durchgefallen">("bestanden");
const pruefer = ref("");
const pruefNotiz = ref("");
const pruefLaeuft = ref(false);

async function pruefFormularOeffnen(): Promise<void> {
  pruefungOffen.value = true;
  if (!pruefarten.value.length) {
    pruefarten.value = await api.get<Pruefart[]>("/pruefarten").catch(() => []);
  }
}

async function pruefungEintragen(): Promise<void> {
  if (pruefLaeuft.value || !pruefartId.value) return;
  pruefLaeuft.value = true;
  try {
    await api.post(`/geraete/${id.value}/pruefungen`, {
      pruefart_id: pruefartId.value,
      geprueft_am: geprueftAm.value,
      ergebnis: pruefErgebnis.value,
      pruefer: pruefer.value || null,
      notiz: pruefNotiz.value || null,
    });
    pruefungOffen.value = false;
    pruefartId.value = "";
    pruefErgebnis.value = "bestanden";
    pruefer.value = "";
    pruefNotiz.value = "";
    await laden();
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Prüfung konnte nicht eingetragen werden";
  } finally {
    pruefLaeuft.value = false;
  }
}

watch(id, () => {
  laedt.value = true;
  fehler.value = null;
  geraet.value = null;
  void laden();
});

onMounted(laden);
</script>

<template>
  <div>
    <!-- ═══ Handy: Kopfzeile oben, alles untereinander ═══════════════════ -->
    <Kopf
      v-if="!breit"
      :titel="geraet?.bezeichnung ?? 'Gerät'"
      zurueck
      :unter="geraet?.inventarnummer ?? ''"
    />

    <!-- ═══ Computer: Kopfleiste mit Nummer, Zustand und Handlungen ══════ -->
    <TopLeiste v-else :titel="geraet?.bezeichnung ?? 'Gerät'" zurueck>
      <template #nebenTitel>
        <template v-if="geraet">
          <span class="pt-mono kopfnummer">{{ geraet.inventarnummer ?? "ohne Nummer" }}</span>
          <StatusChip :status="geraet.status" />
        </template>
      </template>

      <template #rechts>
        <template v-if="geraet">
          <button
            v-if="anmeldung.darf('geraete.pflegen')"
            class="pt-btn"
            @click="router.push(`/geraete/${geraet.id}/bearbeiten`)"
          >
            Stammdaten bearbeiten
          </button>
          <!-- Melden verlangt `schaeden.melden`, nicht `schaeden.bearbeiten`
               (`POST /geraete/:id/schaeden`). Hier stand das falsche Recht:
               Die Rolle „Mitarbeiter" darf melden und sah den Knopf am
               Schreibtisch trotzdem nicht. Erledigen ist eine andere
               Handlung und prüft weiter unten weiter `schaeden.bearbeiten`. -->
          <button
            v-if="anmeldung.darf('schaeden.melden')"
            class="pt-btn"
            :aria-expanded="schadenOffen"
            @click="schadenOffen = !schadenOffen"
          >
            Schaden melden
          </button>

          <!-- Die Reihenfolge ist die des Servers, die Hauptaktion rechts. -->
          <button
            v-for="a in erlaubteAktionen"
            :key="a.art"
            class="pt-btn"
            :class="{ 'pt-btn--primaer': a.hauptaktion }"
            @click="buchen(a.art)"
          >
            {{ a.text }}
          </button>
        </template>
      </template>
    </TopLeiste>

    <!-- ═══════════════════════ Handy ═══════════════════════════════════ -->
    <div v-if="!breit" class="inhalt">
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
            v-for="a in erlaubteAktionen"
            :key="a.art"
            class="pt-btn pt-btn--breit"
            :class="a.hauptaktion ? 'pt-btn--primaer pt-btn--gross' : ''"
            @click="buchen(a.art)"
          >
            {{ a.text }}
          </button>
          <button
            v-if="anmeldung.darf('schaeden.melden')"
            class="pt-btn pt-btn--breit"
            @click="schadenOffen = !schadenOffen"
          >
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
        <section>
          <div class="abschnitt-kopf">
            <h2 class="pt-mikro abschnitt">Prüfungen</h2>
            <button
              v-if="anmeldung.darf('pruefungen.eintragen')"
              class="pt-btn pruef-eintragen-btn"
              @click="pruefFormularOeffnen"
            >
              + Eintragen
            </button>
          </div>

          <!-- Formular -->
          <form v-if="pruefungOffen" class="pt-karte pruef-form" @submit.prevent="pruefungEintragen">
            <label class="pruef-form__feld">
              <span class="pruef-form__label">Prüfart</span>
              <select v-model="pruefartId" required class="pt-feld">
                <option value="" disabled>Bitte wählen</option>
                <option v-for="a in pruefarten.filter(a => a.aktiv)" :key="a.id" :value="a.id">
                  {{ a.name }} (alle {{ a.intervall_monate }} Mo.)
                </option>
              </select>
            </label>
            <label class="pruef-form__feld">
              <span class="pruef-form__label">Geprüft am</span>
              <input v-model="geprueftAm" type="date" required class="pt-feld" />
            </label>
            <label class="pruef-form__feld">
              <span class="pruef-form__label">Ergebnis</span>
              <select v-model="pruefErgebnis" class="pt-feld">
                <option value="bestanden">Bestanden</option>
                <option value="maengel">Mängel</option>
                <option value="durchgefallen">Durchgefallen</option>
              </select>
            </label>
            <label class="pruef-form__feld">
              <span class="pruef-form__label">Prüfer (optional)</span>
              <input v-model="pruefer" type="text" maxlength="120" class="pt-feld" />
            </label>
            <label class="pruef-form__feld">
              <span class="pruef-form__label">Notiz (optional)</span>
              <textarea v-model="pruefNotiz" rows="2" maxlength="2000" class="pt-feld"></textarea>
            </label>
            <div class="pruef-form__aktionen">
              <button type="submit" class="pt-btn pt-btn--primaer" :disabled="pruefLaeuft || !pruefartId">
                {{ pruefLaeuft ? "Wird gespeichert …" : "Speichern" }}
              </button>
              <button type="button" class="pt-btn" @click="pruefungOffen = false">Abbrechen</button>
            </div>
          </form>

          <ul v-if="pruefungen.length" class="pt-karte pt-liste">
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
          <p v-else-if="!pruefungOffen" class="pt-leer">Noch keine Prüfung eingetragen.</p>
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

    <!-- ═══════════════════════ Computer ════════════════════════════════ -->
    <div v-else class="tafel">
      <p v-if="gebuchtMeldung" class="pt-meldung pt-meldung--erfolg gebucht">
        {{ gebuchtMeldung }}
      </p>
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>
      <p v-else-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <div v-else-if="geraet" class="tafel__raster">
        <!-- ── Links: wo es steht, und was mit ihm geschah ────────────── -->
        <div class="saeule">
          <div class="pt-karte ortkarte">
            <p class="ortsatz">
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

            <!-- Warnungen zuerst, dann die Schlagworte: Was fehlt, steht
                 vor dem, was einordnet. -->
            <div
              v-if="offeneSchaeden.length || pruefwarnung || geraet.schlagworte.length"
              class="merkmale"
            >
              <span v-if="offeneSchaeden.length" class="pt-chip pt-chip--defekt">
                {{ offeneSchaeden.length }} offen{{ offeneSchaeden.length === 1 ? "er" : "e" }} Schaden
              </span>
              <span v-if="pruefwarnung" class="pt-chip pt-chip--defekt">{{ pruefwarnung }}</span>
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

          <!-- ── Schaden melden ──────────────────────────────────────── -->
          <div v-if="schadenOffen" class="pt-karte melder">
            <div>
              <label class="pt-label" for="schaden-breit">Was ist mit dem Gerät?</label>
              <input
                id="schaden-breit"
                v-model="schadenText"
                class="pt-feld"
                type="text"
                placeholder="z. B. Motor läuft unrund"
              />
            </div>
            <div>
              <label class="pt-label" for="schwere-breit">Wie schlimm?</label>
              <select id="schwere-breit" v-model="schadenSchwere" class="pt-feld">
                <option value="gering">Gering — lässt sich weiter benutzen</option>
                <option value="mittel">Mittel — eingeschränkt benutzbar</option>
                <option value="ausfall">Ausfall — sperrt das Gerät sofort</option>
              </select>
            </div>
            <div class="melder__fuss">
              <button class="pt-btn pt-btn--still" @click="schadenOffen = false">Abbrechen</button>
              <button
                class="pt-btn pt-btn--primaer"
                :disabled="schadenText.trim().length < 3 || schadenLaeuft"
                @click="schadenMelden"
              >
                Schaden melden
              </button>
            </div>
          </div>

          <!-- ── Schäden ─────────────────────────────────────────────────
               Steht am Computer über dem Verlauf: Wer hier sitzt, schließt
               Meldungen ab — der Knopf dafür gibt es nur an dieser Stelle. -->
          <section v-if="schaeden.length" class="pt-karte schadenkarte">
            <div class="kartenkopf">
              <h2 class="kartentitel">Schäden</h2>
              <span class="kartenzahl">{{ offeneSchaeden.length }} offen</span>
            </div>
            <ul class="pt-liste">
              <li v-for="s in schaeden" :key="s.id">
                <div class="schaden">
                  <div class="schaden__kopf">
                    <span
                      class="pt-chip"
                      :class="s.status === 'erledigt' ? 'pt-chip--neutral' : 'pt-chip--defekt'"
                    >
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

          <!-- ── Verlauf, offen ──────────────────────────────────────── -->
          <section class="pt-karte">
            <div class="kartenkopf">
              <h2 class="kartentitel">Verlauf</h2>
              <span class="kartenzahl">
                {{ historie.length }} {{ historie.length === 1 ? "Buchung" : "Buchungen" }}
              </span>
            </div>

            <p v-if="!historie.length" class="pt-leer">Noch keine Buchung.</p>
            <ol v-else class="strang">
              <li v-for="b in historie" :key="b.id" class="strang__zeile">
                <span class="strang__punkt" aria-hidden="true"></span>

                <div class="strang__text">
                  <strong class="strang__art">{{ ART_TEXT[b.art] ?? b.art }}</strong>
                  <span class="strang__ziel">
                    <template v-if="b.nach_standort">→ {{ b.nach_standort }}</template>
                    <template v-if="b.nach_lagerplatz"> · {{ b.nach_lagerplatz }}</template>
                    <template v-if="b.empfaenger"> · an {{ b.empfaenger }}</template>
                    <template v-if="b.nach_standort || b.empfaenger"> · </template>erfasst von
                    {{ b.erfasser }}
                  </span>
                  <p v-if="b.notiz" class="strang__notiz">{{ b.notiz }}</p>

                  <!-- Die Übergabefotos gehören auch hierher: Am
                       Schreibtisch wird der Streitfall aufgeklärt, nicht
                       auf dem Hänger. -->
                  <div v-if="fotosZurBuchung(b.id).length" class="strang__fotos">
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
                        class="strang__foto"
                        loading="lazy"
                      />
                    </a>
                  </div>
                </div>

                <span class="pt-mono strang__zeit">{{ zeit(b.zeitpunkt) }}</span>
              </li>
            </ol>
          </section>
        </div>

        <!-- ── Rechts: Bilder, Stammdaten, Fristen ────────────────────── -->
        <div class="saeule">
          <!--
            Die Galerie bleibt dieselbe Komponente wie am Handy; nur der
            Rahmen um sie herum stellt das Titelbild auf 210 px und die
            Kacheln in ein 3er-Raster. So bleibt am Computer auch das
            Hochladen, Löschen und Setzen des Titelbilds erreichbar —
            eine reine Anzeigekarte hätte das stillschweigend gekostet.
          -->
          <div class="pt-karte bildfeld">
            <DateiGalerie :geraet-id="geraet.id" :dateien="dateien" @geaendert="laden" />
          </div>

          <dl class="pt-karte stammliste">
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
            <template v-if="geraet.gehoert_zu">
              <dt>Gehört zu</dt>
              <dd>
                <RouterLink v-if="geraet.gehoert_zu_id" :to="`/geraete/${geraet.gehoert_zu_id}`">
                  {{ geraet.gehoert_zu }}
                </RouterLink>
                <template v-else>{{ geraet.gehoert_zu }}</template>
              </dd>
            </template>
            <template v-if="geraet.zubehoer.length">
              <dt>Zubehör</dt>
              <dd>
                <RouterLink
                  v-for="z in geraet.zubehoer"
                  :key="z.id"
                  :to="`/geraete/${z.id}`"
                  class="teil"
                >
                  {{ z.bezeichnung }}
                  <span class="pt-mono pt-gedaempft">{{ z.inventarnummer }}</span>
                </RouterLink>
              </dd>
            </template>
            <template v-if="geraet.notiz">
              <dt>Notiz</dt>
              <dd>{{ geraet.notiz }}</dd>
            </template>
          </dl>

          <section class="pt-karte">
            <div class="kartenkopf">
              <h2 class="kartentitel">Prüfungen</h2>
              <button
                v-if="anmeldung.darf('pruefungen.eintragen')"
                class="pt-btn pruef-eintragen-btn"
                @click="pruefFormularOeffnen"
              >
                + Eintragen
              </button>
            </div>

            <form v-if="pruefungOffen" class="pruef-form pruef-form--innen" @submit.prevent="pruefungEintragen">
              <label class="pruef-form__feld">
                <span class="pruef-form__label">Prüfart</span>
                <select v-model="pruefartId" required class="pt-feld">
                  <option value="" disabled>Bitte wählen</option>
                  <option v-for="a in pruefarten.filter(a => a.aktiv)" :key="a.id" :value="a.id">
                    {{ a.name }} (alle {{ a.intervall_monate }} Mo.)
                  </option>
                </select>
              </label>
              <label class="pruef-form__feld">
                <span class="pruef-form__label">Geprüft am</span>
                <input v-model="geprueftAm" type="date" required class="pt-feld" />
              </label>
              <label class="pruef-form__feld">
                <span class="pruef-form__label">Ergebnis</span>
                <select v-model="pruefErgebnis" class="pt-feld">
                  <option value="bestanden">Bestanden</option>
                  <option value="maengel">Mängel</option>
                  <option value="durchgefallen">Durchgefallen</option>
                </select>
              </label>
              <label class="pruef-form__feld">
                <span class="pruef-form__label">Prüfer (optional)</span>
                <input v-model="pruefer" type="text" maxlength="120" class="pt-feld" />
              </label>
              <label class="pruef-form__feld">
                <span class="pruef-form__label">Notiz (optional)</span>
                <textarea v-model="pruefNotiz" rows="2" maxlength="2000" class="pt-feld"></textarea>
              </label>
              <div class="pruef-form__aktionen">
                <button type="submit" class="pt-btn pt-btn--primaer" :disabled="pruefLaeuft || !pruefartId">
                  {{ pruefLaeuft ? "Wird gespeichert …" : "Speichern" }}
                </button>
                <button type="button" class="pt-btn" @click="pruefungOffen = false">Abbrechen</button>
              </div>
            </form>

            <ul v-if="pruefungen.length" class="pt-liste">
              <li v-for="p in pruefungen" :key="p.id">
                <div class="pt-zeile pt-zeile--still pruefzeile">
                  <div class="pt-zeile__haupt">
                    <div class="pt-zeile__titel">{{ p.pruefart }}</div>
                    <div class="pt-zeile__unter">
                      geprüft {{ datum(p.geprueft_am) }} · nächste {{ datum(p.naechste_faellig) }}
                    </div>
                  </div>
                  <span class="pt-chip" :class="ampelKlasse(ampelVon(p.naechste_faellig))">
                    {{ frist(tageBis(p.naechste_faellig)) }}
                  </span>
                </div>
              </li>
            </ul>
            <p v-else-if="!pruefungOffen" class="pt-leer pruef-leer">Noch keine Prüfung eingetragen.</p>
          </section>
        </div>
      </div>
    </div>

    <!--
      Der Buchen-Dialog. Nur am Computer, und nur solange eine Art gewählt
      ist — er schließt sich nie selbst, das Schließen gehört hierher.
    -->
    <BuchenDialog
      v-if="dialogArt && geraet"
      :geraet="geraet"
      :art="dialogArt"
      @schliessen="dialogArt = null"
      @gebucht="nachDerBuchung"
    />
  </div>
</template>

<style scoped>
/* Sitzt über dem Raster, damit sie nichts verschiebt, was man gerade liest. */
.gebucht {
  margin-bottom: var(--space-4);
}

/* ═══════════════════════════ Handy ═══════════════════════════════════ */

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

/* ═══════════════════════════ Computer ════════════════════════════════ */

/* Nummer und Zustand stehen unmittelbar neben dem Titel — sie gehören zur
   Überschrift, nicht zu den Handlungen. */
.kopfnummer {
  flex: none;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.tafel {
  padding: var(--space-6);
}
.tafel__raster {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: var(--space-6);
  align-items: start;
}

.saeule {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  min-width: 0;
}

.ortkarte {
  padding: var(--space-5) var(--space-6);
}
.ortsatz {
  font-size: var(--fs-16);
}
.ortsatz strong {
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.merkmale {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.melder {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-5) var(--space-6);
}
.melder__fuss {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

/* ── Kartenköpfe, wie in der Übersicht ──────────────────── */
.kartenkopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
}
.kartentitel {
  font-size: var(--fs-15);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.kartenzahl {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}

.schadenkarte .schaden {
  padding: var(--space-3) var(--space-5);
}

/* ── Zeitstrahl ─────────────────────────────────────────────────────────
   Anders gebaut als am Handy: keine verbindende Linie, dafür Hairlines
   zwischen den Zeilen und der Zeitpunkt in einer eigenen rechten Spalte.
   Auf 780 px Breite ist das lesbarer als eine Kopfzeile, in der Art und
   Zeitpunkt um denselben Platz streiten. */
.strang {
  list-style: none;
  margin: 0;
  padding: var(--space-4) var(--space-5);
}
.strang__zeile {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-3) 0;
}
.strang__zeile + .strang__zeile {
  border-top: 1px solid var(--hairline);
}
.strang__punkt {
  flex: none;
  width: 8px;
  height: 8px;
  margin-top: 7px;
  background: var(--fg-subtle);
  border-radius: var(--radius-full);
}
/* Der jüngste Eintrag trägt volles Ink — er ist der aktuelle Zustand. */
.strang__zeile:first-child .strang__punkt {
  background: var(--fg);
}
.strang__text {
  flex: 1;
  min-width: 0;
}
.strang__art {
  font-size: var(--fs-14);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.strang__ziel {
  display: block;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.strang__notiz {
  margin-top: var(--space-1);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-13);
  background: var(--surface-muted);
  border-radius: var(--radius-md);
}
.strang__fotos {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.strang__foto {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
}
.strang__zeit {
  flex: none;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

/* ── Bildkarte ──────────────────────────────────────────────────────────
   Die Regeln greifen absichtlich in `DateiGalerie.vue` hinein: Die
   Komponente bleibt unverändert (sie wird am Handy genauso gebraucht),
   nur ihr Raster wird hier auf drei Spalten festgelegt und das Titelbild
   auf die volle Breite gestellt. `order: -1` zieht es nach vorn, falls
   der Server es nicht als erstes liefert. */
.bildfeld {
  padding: var(--space-3);
}
.bildfeld :deep(.raster) {
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-2);
}
.bildfeld :deep(.kachel) {
  border-radius: var(--radius-md);
}
.bildfeld :deep(.kachel--titel) {
  order: -1;
  grid-column: 1 / -1;
  aspect-ratio: auto;
  height: 210px;
}
.bildfeld :deep(.leer) {
  padding: var(--space-5) var(--space-3);
}

.stammliste {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-2) var(--space-4);
  margin: 0;
  padding: var(--space-5);
  font-size: var(--fs-14);
}
.stammliste dt {
  color: var(--fg-muted);
}
.stammliste dd {
  margin: 0;
  color: var(--fg-body);
}
.teil {
  display: block;
}

.pruefzeile {
  padding: var(--space-3) var(--space-5);
}
.pruef-leer {
  padding: var(--space-4) var(--space-5);
}

/* ── Prüfung-eintragen-Kopf ───────────────────────── */
.abschnitt-kopf {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* ── Prüfungs-Formular ────────────────────────────── */
.pruef-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}
.pruef-form--innen {
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
}
.pruef-form__feld {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.pruef-form__label {
  font-size: var(--fs-13);
  color: var(--fg-muted);
  font-weight: var(--fw-medium);
}
.pruef-form__aktionen {
  display: flex;
  gap: var(--space-2);
}
.pruef-eintragen-btn {
  font-size: var(--fs-13);
  padding: var(--space-1) var(--space-3);
}
</style>
