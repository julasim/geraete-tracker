<script setup lang="ts">
/**
 * Etiketten drucken.
 *
 * Der wichtigste Teil dieser Seite ist der Hinweis zur Druckeinstellung.
 * Der Standardfall im Browser ist "an Seite anpassen", und damit schrumpft
 * der Barcode um 3 bis 5 % — genug, dass ihn die Kamera nicht mehr liest.
 * Das merkt man erst, wenn 200 Etiketten kleben.
 *
 * Deshalb auch der Testbogen: erst vier Stück drucken, kleben, scannen,
 * und dann der große Lauf.
 *
 * ── Zwei Haltungen, eine Fachlichkeit ──────────────────────────────────
 * Unter 1024 px die Handy-Haltung: eine Spalte, Abschnitte untereinander,
 * die Fußleiste über der Navigationsleiste. Ab 1024 px das Pult: links die
 * Auswahl, rechts Nummernstand, Vorrat und Bogen nebeneinander.
 *
 * Getrennte Vorlagen, EIN Zustand. Die beiden unterscheiden sich in fast
 * jedem Maß (Kartenliste gegen Tabelle, feste Fußleiste gegen Kartenfuß),
 * eine gemeinsame Vorlage mit Weichen wäre unlesbar. Die Regeln, an denen
 * hier Geld hängt — Nummern sind ab dem Druck verbraucht, zwei getrennte
 * Nummernkreise, kein automatischer Druckdialog — stehen deshalb genau
 * einmal im Skript und gelten für beide.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { api } from "@/api";
import { useBreite } from "@/composables/useBreite";
import { useBestand } from "@/stores/bestand";
import Kopf from "@/components/Kopf.vue";
import Symbol from "@/components/Symbol.vue";
import TopLeiste from "@/components/TopLeiste.vue";

const bestand = useBestand();
const { breit, tablet } = useBreite();

interface FormatInfo {
  schluessel: string;
  name: string;
  proBogen: number;
}

const formate = ref<FormatInfo[]>([]);
const format = ref("70x37");
const firmenname = ref("");
const gewaehlt = ref<Set<string>>(new Set());
const startPosition = ref(0);
const suchtext = ref("");
const laeuft = ref(false);
const fehler = ref<string | null>(null);

/**
 * Läuft der erste Ladevorgang noch?
 *
 * Nur für die Computer-Haltung: Dort stehen Tabelle und Nummernstand in
 * eigenen Karten, und eine leere Karte ohne Erklärung sieht aus wie ein
 * leerer Bestand. Am Handy wächst die Liste einfach ein, sobald sie da ist.
 */
const laedtSeite = ref(true);

/** Wie viele Etiketten auf Vorrat gedruckt werden sollen. */
const vorratAnzahl = ref(24);
const vorratLaeuft = ref(false);
const vorratErgebnis = ref<string | null>(null);

interface Nummernstand {
  vergeben: number;
  reserviert: number;
  gesehen: number;
  hoechste: string | null;
  offen: { nummer: string }[];
}
const stand = ref<Nummernstand | null>(null);

const naechsteNummer = computed(() =>
  stand.value?.hoechste
    ? String(Number(stand.value.hoechste) + 1).padStart(stand.value.hoechste.length, "0")
    : "10001",
);

/**
 * Welchen Bereich der Vorratsbogen voraussichtlich verbraucht.
 *
 * Er steht hier, weil die Nummern ab dem Druck weg sind — auch wenn der
 * Bogen im Papierkorb landet. Wer 24 Stück auslöst, soll vorher sehen,
 * welche 24 das kosten wird, und nicht erst hinterher.
 *
 * "Voraussichtlich" ist kein Weichmacher, sondern die Wahrheit: Vergeben
 * wird ausschließlich im Server, und der überspringt Nummern, die oberhalb
 * der Reihe schon belegt sind — etwa ein beim Scannen aufgetauchtes
 * Altetikett. Diese Vorschau darf deshalb nie als Zusage gelesen werden;
 * was wirklich auf dem Bogen steht, meldet der Server nach dem Druck.
 */
const vorratBereich = computed(() => {
  const anzahl = vorratAnzahl.value;
  if (!Number.isFinite(anzahl) || anzahl < 1) return null;
  const von = naechsteNummer.value;
  return { von, bis: String(Number(von) + anzahl - 1).padStart(von.length, "0") };
});

const liste = computed(() => bestand.suche(suchtext.value));

/**
 * Regalplätze — der zweite Nummernkreis.
 *
 * Bewusst eine getrennte Auswahl und ein getrennter Knopf: Geräte-Etiketten
 * (Ziffern) und Regal-Etiketten (P-…) sind in dieser Anwendung durchgängig
 * getrennt, bis hinunter in zwei CHECK-Constraints der Datenbank. Ein
 * gemeinsamer Bogen wäre die erste Stelle, an der sie wieder zusammenliefen.
 */
const plaetze = computed(() => bestand.lagerplaetze.filter((p) => p.aktiv && p.barcode));
const gewaehlteePlaetze = ref<Set<string>>(new Set());
const platzLaeuft = ref(false);

const platzAnzahl = computed(() => gewaehlteePlaetze.value.size);

function platzUmschalten(id: string): void {
  const neu = new Set(gewaehlteePlaetze.value);
  if (neu.has(id)) neu.delete(id);
  else neu.add(id);
  gewaehlteePlaetze.value = neu;
}

async function regaleDrucken(): Promise<void> {
  if (!platzAnzahl.value || platzLaeuft.value) return;
  platzLaeuft.value = true;
  fehler.value = null;
  try {
    const antwort = await fetch("/api/etiketten/lagerplaetze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        lagerplaetze: [...gewaehlteePlaetze.value],
        format: format.value,
        startPosition: startPosition.value,
      }),
    });
    if (!antwort.ok) {
      const daten = await antwort.json().catch(() => ({}));
      throw new Error(daten.error ?? "Die Etiketten konnten nicht erzeugt werden");
    }
    window.open(URL.createObjectURL(await antwort.blob()), "_blank");
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Die Etiketten konnten nicht erzeugt werden";
  } finally {
    platzLaeuft.value = false;
  }
}
const anzahl = computed(() => gewaehlt.value.size);
const proBogen = computed(
  () => formate.value.find((f) => f.schluessel === format.value)?.proBogen ?? 24,
);
const boegen = computed(() => Math.ceil((anzahl.value + startPosition.value) / proBogen.value));

/**
 * Wer gerade Geräte erfasst hat, kommt mit ihren Ids hierher.
 *
 * `/etiketten?geraete=<id>,<id>` — die Erfassung („Anlegen und nächstes")
 * schickt ihre Sitzung mit, damit man nach zwanzig Maschinen nicht zwanzig
 * Zeilen von Hand wieder zusammensucht. Übernommen wird nur, was es im
 * Bestand wirklich gibt: Eine Id aus einer alten Adresse soll keine
 * Etikettenzahl in die Höhe treiben.
 */
const route = useRoute();

function auswahlAusAdresse(): void {
  const roh = route.query.geraete;
  if (typeof roh !== "string" || !roh) return;
  const bekannt = new Set(bestand.geraete.map((g) => g.id));
  const treffer = roh.split(",").filter((id) => id && bekannt.has(id));
  if (treffer.length) gewaehlt.value = new Set(treffer);
}

onMounted(async () => {
  await bestand.laden();
  auswahlAusAdresse();
  try {
    const antwort = await api.get<{
      formate: FormatInfo[];
      voreinstellung: string;
      firmenname: string;
    }>("/etiketten/formate");
    formate.value = antwort.formate;
    format.value = antwort.voreinstellung;
    firmenname.value = antwort.firmenname;
  } catch {
    // Die Auswahl ist Beiwerk — ohne sie greift die Voreinstellung.
  }
  await ladeStand();
  laedtSeite.value = false;
});

async function ladeStand(): Promise<void> {
  try {
    stand.value = await api.get<Nummernstand>("/etiketten/nummern");
  } catch {
    stand.value = null;
  }
}

/**
 * Etiketten auf Vorrat: neue Nummern erzeugen und drucken.
 *
 * Die Nummern sind ab dem Druck verbraucht — auch wenn der Bogen im
 * Papierkorb landet. Das ist Absicht: Eine verlorene Nummer kostet nichts,
 * eine doppelt geklebte kostet die Verlässlichkeit des ganzen Bestands.
 */
async function vorratDrucken(): Promise<void> {
  if (vorratLaeuft.value) return;
  if (!confirm(
    `${vorratAnzahl.value} neue Nummern ab ${naechsteNummer.value} erzeugen und drucken?

` +
      "Diese Nummern sind danach vergeben und werden nie erneut ausgegeben.",
  )) return;

  vorratLaeuft.value = true;
  fehler.value = null;
  vorratErgebnis.value = null;
  try {
    const antwort = await fetch("/api/etiketten/vorrat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        anzahl: vorratAnzahl.value,
        format: format.value,
        startPosition: startPosition.value,
      }),
    });
    if (!antwort.ok) {
      const daten = await antwort.json().catch(() => ({}));
      throw new Error(daten.error ?? "Der Vorratsbogen konnte nicht erzeugt werden");
    }
    const von = antwort.headers.get("X-Nummern-Von");
    const bis = antwort.headers.get("X-Nummern-Bis");
    vorratErgebnis.value = `${von} bis ${bis} — gedruckt und reserviert.`;
    window.open(URL.createObjectURL(await antwort.blob()), "_blank");
    await ladeStand();
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Der Vorratsbogen konnte nicht erzeugt werden";
  } finally {
    vorratLaeuft.value = false;
  }
}

function umschalten(id: string): void {
  const neu = new Set(gewaehlt.value);
  if (neu.has(id)) neu.delete(id);
  else neu.add(id);
  gewaehlt.value = neu;
}

function alleSichtbaren(): void {
  gewaehlt.value = new Set(liste.value.map((g) => g.id));
}

function keine(): void {
  gewaehlt.value = new Set();
}

/**
 * Öffnet das PDF in einem neuen Fenster.
 *
 * Bewusst kein automatischer Druckdialog: Der Benutzer soll den Bogen
 * zuerst ansehen und dann selbst drucken — mit der richtigen Einstellung.
 */
async function drucken(): Promise<void> {
  if (!anzahl.value || laeuft.value) return;
  laeuft.value = true;
  fehler.value = null;
  try {
    const antwort = await fetch("/api/etiketten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        geraete: [...gewaehlt.value],
        format: format.value,
        startPosition: startPosition.value,
      }),
    });
    if (!antwort.ok) {
      const daten = await antwort.json().catch(() => ({}));
      throw new Error(daten.error ?? "Die Etiketten konnten nicht erzeugt werden");
    }
    const brocken = await antwort.blob();
    window.open(URL.createObjectURL(brocken), "_blank");
  } catch (f) {
    fehler.value = f instanceof Error ? f.message : "Die Etiketten konnten nicht erzeugt werden";
  } finally {
    laeuft.value = false;
  }
}
</script>

<template>
  <div>
    <TopLeiste v-if="breit" titel="Etiketten drucken">
      <template #rechts>
        <a
          class="pt-btn"
          :href="`/api/etiketten/testbogen?format=${format}`"
          target="_blank"
          rel="noopener"
        >
          Testbogen öffnen
        </a>
      </template>
    </TopLeiste>
    <Kopf v-else titel="Etiketten drucken" zurueck />

    <!-- ══ Computer und iPad ══════════════════════════════════════════ -->
    <div v-if="breit" class="et-pult" :class="{ 'et-pult--tablet': tablet }">
      <div class="et-spalte">
        <!-- Der Hinweis steht ganz oben, nicht unten: Er entscheidet
             darüber, ob die gedruckten Etiketten hinterher funktionieren.
             Unter der Tabelle läse ihn, wer schon ausgewählt hat. -->
        <div class="pt-meldung pt-meldung--warnung wichtig">
          <Symbol name="warnung" :groesse="18" />
          <div>
            <strong>Vor dem Drucken: Skalierung auf 100 % stellen.</strong>
            Im Druckdialog „Tatsächliche Größe" wählen, nicht „An Seite anpassen".
            Sonst schrumpft der Barcode um einige Prozent und lässt sich später
            nicht mehr scannen.
          </div>
        </div>

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <!-- ── Geräte auswählen ──────────────────────────────────── -->
        <section class="pt-karte">
          <div class="et-kopf">
            <h2 class="et-titel">Geräte auswählen</h2>
            <div class="et-suche">
              <Symbol name="suche" :groesse="16" />
              <input
                v-model="suchtext"
                class="pt-feld"
                type="search"
                placeholder="Suchen …"
                autocapitalize="off"
                aria-label="Geräte suchen"
              />
            </div>
            <button class="pt-btn et-klein" @click="alleSichtbaren">
              Alle {{ liste.length }}
            </button>
            <button class="pt-btn et-klein" :disabled="!anzahl" @click="keine">Keine</button>
          </div>

          <div class="et-tabelle">
            <div class="et-tabelle__kopf">
              <span></span>
              <span>Nummer</span>
              <span>Bezeichnung</span>
              <span>Ort</span>
            </div>

            <p v-if="laedtSeite" class="pt-leer">Wird geladen …</p>
            <p v-else-if="!liste.length" class="pt-leer">
              {{ suchtext ? "Kein Gerät passt zur Suche." : "Hier steht derzeit nichts." }}
            </p>

            <button
              v-for="g in liste"
              :key="g.id"
              type="button"
              class="et-zeile"
              :class="{ 'et-zeile--gewaehlt': gewaehlt.has(g.id) }"
              :aria-pressed="gewaehlt.has(g.id)"
              @click="umschalten(g.id)"
            >
              <span class="et-kast" :class="{ 'et-kast--an': gewaehlt.has(g.id) }">
                <Symbol v-if="gewaehlt.has(g.id)" name="haken" :groesse="12" />
              </span>
              <span class="pt-mono et-schmal" :class="{ 'et-ohne': !g.inventarnummer }">
                {{ g.inventarnummer ?? "—" }}
              </span>
              <span class="et-schmal">{{ g.bezeichnung }}</span>
              <span class="et-schmal" :class="{ 'et-ohne': !g.standort }">
                {{ g.standort ?? "—" }}
              </span>
            </button>
          </div>

          <div class="et-fuss">
            <span class="et-fuss__text">
              {{ anzahl }} {{ anzahl === 1 ? "Etikett" : "Etiketten" }} ·
              {{ boegen }} {{ boegen === 1 ? "Bogen" : "Bögen" }} ·
              Start bei Position {{ startPosition }}
            </span>
            <button
              class="pt-btn pt-btn--primaer et-drucken"
              :disabled="!anzahl || laeuft"
              @click="drucken"
            >
              {{ laeuft ? "Wird erzeugt …" : "PDF öffnen" }}
            </button>
          </div>
        </section>

        <!-- ── Regalplätze: eigener Bogen, eigener Knopf ─────────── -->
        <section v-if="plaetze.length" class="pt-karte">
          <div class="et-kopf">
            <h2 class="et-titel">Regalplätze</h2>
            <span class="et-hinweis">
              Eigener Bogen — Kennungen mit <span class="pt-mono">P-</span> dürfen nie
              zwischen die Gerätenummern geraten
            </span>
          </div>
          <div class="et-pillen">
            <button
              v-for="pl in plaetze"
              :key="pl.id"
              type="button"
              class="et-pille"
              :class="{ 'et-pille--an': gewaehlteePlaetze.has(pl.id) }"
              :aria-pressed="gewaehlteePlaetze.has(pl.id)"
              @click="platzUmschalten(pl.id)"
            >
              {{ pl.bezeichnung }}
              <span class="pt-mono">{{ pl.barcode }}</span>
            </button>
            <button
              class="pt-btn et-klein et-regaldruck"
              :disabled="!platzAnzahl || platzLaeuft"
              @click="regaleDrucken"
            >
              {{
                platzLaeuft
                  ? "Wird erzeugt …"
                  : `${platzAnzahl} Regal-Etikett${platzAnzahl === 1 ? "" : "en"} öffnen`
              }}
            </button>
          </div>
        </section>
      </div>

      <div class="et-spalte">
        <!-- ── Nummernstand ─────────────────────────────────────── -->
        <section class="pt-karte">
          <div class="et-kopf"><h2 class="et-titel">Nummernstand</h2></div>
          <div v-if="stand" class="et-stand">
            <div class="et-stand__zeile">
              <span>Nächste freie Nummer</span>
              <strong class="pt-mono">{{ naechsteNummer }}</strong>
            </div>
            <div class="et-stand__zeile"><span>Vergeben</span><strong>{{ stand.vergeben }}</strong></div>
            <div class="et-stand__zeile">
              <span>Gedruckt, noch nicht erfasst</span>
              <strong>{{ stand.reserviert }}</strong>
            </div>
            <div class="et-stand__zeile">
              <span>Beim Scannen aufgetaucht</span>
              <strong>{{ stand.gesehen }}</strong>
            </div>
          </div>
          <p v-else-if="laedtSeite" class="pt-leer">Wird geladen …</p>
          <p v-else class="pt-leer">Der Nummernstand ist gerade nicht abrufbar.</p>
        </section>

        <!-- ── Etiketten auf Vorrat ─────────────────────────────── -->
        <section class="pt-karte et-block">
          <h2 class="et-ueberschrift">Etiketten auf Vorrat</h2>
          <p class="et-text">
            Für Geräte, die noch nicht erfasst sind: Bogen drucken, aufkleben,
            später in Ruhe erfassen. Die Nummern werden dabei <strong>sofort
            reserviert</strong> und nie ein zweites Mal vergeben.
          </p>

          <div class="feld">
            <label class="pt-label" for="vorrat-anzahl">Wie viele Etiketten?</label>
            <input
              id="vorrat-anzahl"
              v-model.number="vorratAnzahl"
              class="pt-feld"
              type="number"
              min="1"
              max="500"
            />
          </div>

          <!-- Vor dem Auslösen, nicht danach: Was hier steht, ist ab dem
               Druck verbraucht. -->
          <p v-if="vorratBereich" class="et-hinweis">
            Ergibt voraussichtlich <span class="pt-mono">{{ vorratBereich.von }}</span> bis
            <span class="pt-mono">{{ vorratBereich.bis }}</span> — belegte Nummern
            überspringt der Server.
          </p>

          <button
            class="pt-btn pt-btn--primaer pt-btn--breit"
            :disabled="vorratLaeuft || vorratAnzahl < 1"
            @click="vorratDrucken"
          >
            {{ vorratLaeuft ? "Wird erzeugt …" : `${vorratAnzahl} Etiketten drucken` }}
          </button>

          <p v-if="vorratErgebnis" class="pt-meldung pt-meldung--erfolg">{{ vorratErgebnis }}</p>
        </section>

        <!-- ── Bogen ────────────────────────────────────────────── -->
        <section class="pt-karte et-block">
          <h2 class="et-ueberschrift">Bogen</h2>

          <div class="feld">
            <label class="pt-label" for="bogen-format">Etikettenbogen</label>
            <select id="bogen-format" v-model="format" class="pt-feld">
              <option v-for="f in formate" :key="f.schluessel" :value="f.schluessel">
                {{ f.name }}
              </option>
            </select>
          </div>

          <div class="feld">
            <label class="pt-label" for="bogen-start">Erstes freies Etikett auf dem Bogen</label>
            <input
              id="bogen-start"
              v-model.number="startPosition"
              class="pt-feld"
              type="number"
              min="0"
              :max="proBogen - 1"
            />
            <p class="et-hinweis et-abstand">
              Für angebrochene Bögen: 0 heißt links oben. Sind schon fünf Etiketten
              abgezogen, hier 5 eintragen.
            </p>
          </div>

          <p v-if="firmenname" class="et-hinweis">
            Auf jedem Etikett steht: <strong>{{ firmenname }}</strong>
          </p>
          <p class="et-hinweis">
            Vor dem großen Lauf: Testbogen drucken, ausschneiden, auf ein Gerät kleben
            und mit der App scannen.
          </p>
        </section>
      </div>
    </div>

    <!-- ══ Handy ═════════════════════════════════════════════════════ -->
    <template v-else>
      <div class="inhalt">
        <!-- Der Hinweis steht oben, nicht unten: Er entscheidet darüber,
             ob die gedruckten Etiketten hinterher funktionieren. -->
        <div class="pt-meldung pt-meldung--warnung wichtig">
          <Symbol name="warnung" :groesse="18" />
          <div>
            <strong>Vor dem Drucken: Skalierung auf 100 % stellen.</strong>
            Im Druckdialog „Tatsächliche Größe" wählen, nicht „An Seite anpassen".
            Sonst schrumpft der Barcode um einige Prozent und lässt sich später
            nicht mehr scannen.
          </div>
        </div>

        <section>
          <h2 class="pt-mikro abschnitt">Zuerst ausprobieren</h2>
          <div class="pt-karte block">
            <p class="text">
              Ein Bogen mit vier Etiketten zum Ausprobieren. Drucken, ausschneiden,
              auf ein Gerät kleben und mit der App scannen — erst wenn das klappt,
              lohnt der große Lauf.
            </p>
            <a
              class="pt-btn pt-btn--breit"
              :href="`/api/etiketten/testbogen?format=${format}`"
              target="_blank"
              rel="noopener"
            >
              Testbogen öffnen
            </a>
          </div>
        </section>

        <section>
          <h2 class="pt-mikro abschnitt">Neue Etiketten auf Vorrat</h2>
          <div class="pt-karte block">
            <p class="text">
              Für Geräte, die noch nicht erfasst sind: Bogen drucken, aufkleben,
              später in Ruhe erfassen. Die Nummern werden dabei <strong>sofort
              reserviert</strong> und nie ein zweites Mal vergeben.
            </p>

            <div v-if="stand" class="stand">
              <div class="stand__zeile">
                <span>Nächste freie Nummer</span>
                <strong class="pt-mono">{{ naechsteNummer }}</strong>
              </div>
              <div class="stand__zeile">
                <span>Vergeben</span><strong>{{ stand.vergeben }}</strong>
              </div>
              <div v-if="stand.reserviert" class="stand__zeile">
                <span>Gedruckt, noch nicht erfasst</span>
                <strong>{{ stand.reserviert }}</strong>
              </div>
              <div v-if="stand.gesehen" class="stand__zeile">
                <span>Beim Scannen aufgetaucht</span>
                <strong>{{ stand.gesehen }}</strong>
              </div>
            </div>

            <div class="feld">
              <label class="pt-label" for="anzahl">Wie viele Etiketten?</label>
              <input
                id="anzahl"
                v-model.number="vorratAnzahl"
                class="pt-feld"
                type="number"
                min="1"
                max="500"
              />
            </div>

            <p v-if="vorratErgebnis" class="pt-meldung">{{ vorratErgebnis }}</p>

            <button
              class="pt-btn pt-btn--primaer pt-btn--breit"
              :disabled="vorratLaeuft || vorratAnzahl < 1"
              @click="vorratDrucken"
            >
              {{ vorratLaeuft ? "Wird erzeugt …" : `${vorratAnzahl} Etiketten drucken` }}
            </button>
          </div>
        </section>

        <section>
          <h2 class="pt-mikro abschnitt">Bogen</h2>
          <div class="pt-karte block">
            <div class="feld">
              <label class="pt-label" for="format">Etikettenbogen</label>
              <select id="format" v-model="format" class="pt-feld">
                <option v-for="f in formate" :key="f.schluessel" :value="f.schluessel">
                  {{ f.name }}
                </option>
              </select>
            </div>

            <div class="feld">
              <label class="pt-label" for="start">Erstes freies Etikett auf dem Bogen</label>
              <input
                id="start"
                v-model.number="startPosition"
                class="pt-feld"
                type="number"
                min="0"
                :max="proBogen - 1"
              />
              <p class="hinweis">
                Für angebrochene Bögen: 0 heißt links oben. Sind schon fünf Etiketten
                abgezogen, hier 5 eintragen.
              </p>
            </div>

            <p v-if="firmenname" class="hinweis">
              Auf jedem Etikett steht: <strong>{{ firmenname }}</strong>
            </p>
          </div>
        </section>

        <section>
          <h2 class="pt-mikro abschnitt">Geräte auswählen</h2>

          <div class="werkzeuge">
            <input
              v-model="suchtext"
              class="pt-feld"
              type="search"
              placeholder="Suchen …"
              autocapitalize="off"
            />
            <div class="reihe">
              <button class="pt-btn" @click="alleSichtbaren">Alle {{ liste.length }}</button>
              <button class="pt-btn" :disabled="!anzahl" @click="keine">Keine</button>
            </div>
          </div>

          <ul class="pt-karte pt-liste auswahl">
            <li v-for="g in liste" :key="g.id">
              <button class="pt-zeile" @click="umschalten(g.id)">
                <span class="haken" :class="{ 'haken--an': gewaehlt.has(g.id) }" aria-hidden="true">
                  <Symbol v-if="gewaehlt.has(g.id)" name="haken" :groesse="16" />
                </span>
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ g.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">{{ g.inventarnummer }}</div>
                </div>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="plaetze.length">
          <h2 class="pt-mikro abschnitt">Regalplätze auswählen</h2>
          <p class="pt-gedaempft hinweis regalhinweis">
            Eigener Bogen, eigener Knopf: Regal-Kennungen beginnen mit
            <span class="pt-mono">P-</span> und dürfen nie zwischen die
            Gerätenummern geraten.
          </p>

          <ul class="pt-karte pt-liste auswahl">
            <li v-for="pl in plaetze" :key="pl.id">
              <button class="pt-zeile" @click="platzUmschalten(pl.id)">
                <span
                  class="haken"
                  :class="{ 'haken--an': gewaehlteePlaetze.has(pl.id) }"
                  aria-hidden="true"
                >
                  <Symbol v-if="gewaehlteePlaetze.has(pl.id)" name="haken" :groesse="16" />
                </span>
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ pl.bezeichnung }}</div>
                  <div class="pt-zeile__unter pt-mono">{{ pl.barcode ?? "ohne Kennung" }}</div>
                </div>
              </button>
            </li>
          </ul>

          <div class="regalknopf">
            <button
              class="pt-btn pt-btn--breit"
              :disabled="!platzAnzahl || platzLaeuft"
              @click="regaleDrucken"
            >
              {{
                platzLaeuft
                  ? "Wird erzeugt …"
                  : `${platzAnzahl} Regal-Etikett${platzAnzahl === 1 ? "" : "en"} öffnen`
              }}
            </button>
          </div>
        </section>

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>
      </div>

      <!-- Bleibt am unteren Rand stehen, damit man beim Auswählen sieht,
           wie viele Bögen es werden. -->
      <div v-if="anzahl" class="fussleiste">
        <div class="fussleiste__text">
          {{ anzahl }} Etikett{{ anzahl === 1 ? "" : "en" }} ·
          {{ boegen }} {{ boegen === 1 ? "Bogen" : "Bögen" }}
        </div>
        <button class="pt-btn pt-btn--primaer" :disabled="laeuft" @click="drucken">
          {{ laeuft ? "Wird erzeugt …" : "PDF öffnen" }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* ══ Computer und iPad ═════════════════════════════════════════════ */

.et-pult {
  display: grid;
  grid-template-columns: 1fr 400px;
  gap: var(--space-6);
  align-items: start;
  padding: var(--space-6);
}
.et-spalte {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-width: 0;
}

/* Kartenkopf: Titel links, Werkzeuge rechts. */
.et-kopf {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border);
}
.et-titel,
.et-ueberschrift {
  font-size: var(--fs-15);
  font-weight: var(--fw-semibold);
  color: var(--fg);
}
.et-titel {
  flex: 1;
  min-width: 0;
}

.et-suche {
  position: relative;
  display: flex;
  align-items: center;
  flex: none;
  width: 260px;
}
/* Die Lupe sitzt IM Feld — und darf keine Klicks abfangen, sonst trifft
   ein Klick auf das Symbol das Eingabefeld nicht. */
.et-suche svg {
  position: absolute;
  left: var(--space-3);
  color: var(--fg-subtle);
  pointer-events: none;
}
.et-suche .pt-feld {
  min-height: 36px;
  padding: var(--space-2) var(--space-3) var(--space-2) 36px;
  font-size: var(--fs-14);
}

/* Knöpfe im Kartenkopf sind kleiner als im Inhalt — wie in der Topleiste. */
.et-klein {
  min-height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--fs-13);
}

/* ── Tabelle ──────────────────────────────────────────────────────
 * Sie scrollt in sich statt die ganze Seite zu strecken: Sonst stünden
 * bei 200 Geräten Fußzeile und PDF-Knopf so weit unten, dass man beim
 * Auswählen nicht mehr sieht, wie viele Bögen es werden.
 */
.et-tabelle {
  max-height: 46dvh;
  overflow-y: auto;
}
.et-tabelle__kopf,
.et-zeile {
  display: grid;
  grid-template-columns: 32px 96px minmax(0, 1fr) 200px;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-5);
  width: 100%;
  text-align: left;
}
.et-tabelle__kopf {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 40px;
  font-size: var(--fs-11);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--fg-subtle);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border);
}
.et-zeile {
  height: 44px;
  font-size: var(--fs-14);
  color: var(--fg-body);
  background: none;
  border: 0;
  border-top: 1px solid var(--hairline);
  cursor: pointer;
  transition: background var(--t-fast) var(--ease);
}
.et-zeile:hover {
  background: var(--surface-subtle);
}
.et-zeile--gewaehlt,
.et-zeile--gewaehlt:hover {
  background: var(--surface-muted);
}
.et-schmal {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Ein fehlender Wert ist ein Strich, kein leeres Feld — sonst sieht die
   Zeile aus, als wäre sie nicht fertig geladen. */
.et-ohne {
  color: var(--fg-subtle);
}

.et-kast {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  color: var(--accent-fg);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.et-kast--an {
  background: var(--accent);
  border-color: var(--accent);
}
/* Der Haken ist bei 12 px nur mit kräftigem Strich zu erkennen. */
.et-kast svg {
  stroke-width: 3;
}

.et-fuss {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-top: 1px solid var(--border);
}
.et-fuss__text {
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
.et-drucken {
  min-height: 40px;
}

/* ── Regalplätze ──────────────────────────────────────────────── */
.et-pillen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
}
.et-pille {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  min-height: 32px;
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  cursor: pointer;
  transition:
    background var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}
.et-pille:hover {
  border-color: var(--border-strong);
}
.et-pille--an {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: var(--accent);
}
/* Der Druckknopf sitzt am rechten Rand, auch wenn die Pillen umbrechen. */
.et-regaldruck {
  margin-left: auto;
}

/* ── Nummernstand ─────────────────────────────────────────────── */
.et-stand {
  padding: var(--space-2) 0;
}
.et-stand__zeile {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-5);
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.et-stand__zeile strong {
  color: var(--fg);
  font-variant-numeric: tabular-nums;
}

/* ── Karten mit Formular ──────────────────────────────────────── */
.et-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
}
.et-text {
  font-size: var(--fs-14);
  line-height: var(--lh-normal);
  color: var(--fg-body);
}
.et-hinweis {
  font-size: var(--fs-13);
  line-height: var(--lh-normal);
  color: var(--fg-muted);
}
.et-hinweis strong {
  color: var(--fg);
}
.et-abstand {
  margin-top: var(--space-2);
}

/*
 * Mit dem Finger sind 36 px zu klein — am iPad zurück auf 44. Dieselbe
 * Regel wie in der Topleiste; die Tabellenzeilen liegen mit 44 px schon
 * darüber und bleiben unverändert.
 */
.et-pult--tablet .et-klein,
.et-pult--tablet .et-suche .pt-feld,
.et-pult--tablet .et-pille,
.et-pult--tablet .et-drucken {
  min-height: 44px;
}

/* ══ Handy ═════════════════════════════════════════════════════════ */

.regalhinweis {
  padding: 0 var(--space-4) var(--space-2);
}
.regalknopf {
  padding: var(--space-3) var(--space-4) 0;
}

.stand {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  margin-bottom: var(--space-4);
  background: var(--surface-subtle);
}
.stand__zeile {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--hairline);
  font-size: var(--fs-13);
  color: var(--fg-muted);
}
.stand__zeile:last-child { border-bottom: 0; }
.stand__zeile strong { color: var(--fg); font-variant-numeric: tabular-nums; }

.inhalt {
  padding: var(--space-4);
  padding-bottom: calc(var(--leiste-hoehe) + 80px);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}

.wichtig {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  font-size: var(--fs-14);
  line-height: var(--lh-normal);
}
.wichtig svg {
  flex: none;
  margin-top: 2px;
}

.abschnitt {
  margin-bottom: var(--space-2);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}

.text {
  font-size: var(--fs-14);
  line-height: var(--lh-normal);
  color: var(--fg-body);
}

.feld {
  display: flex;
  flex-direction: column;
}

.hinweis {
  margin-top: var(--space-2);
  font-size: var(--fs-13);
  line-height: var(--lh-normal);
  color: var(--fg-muted);
}
.hinweis strong {
  color: var(--fg);
}

.werkzeuge {
  margin-bottom: var(--space-3);
}
.reihe {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.reihe .pt-btn {
  flex: 1;
  min-height: 40px;
  font-size: var(--fs-13);
}

.auswahl {
  max-height: 50dvh;
  overflow-y: auto;
}

.haken {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  color: var(--accent-fg);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}
.haken--an {
  background: var(--accent);
  border-color: var(--accent);
}

.fussleiste {
  position: fixed;
  left: 0;
  right: 0;
  bottom: calc(var(--leiste-hoehe) + env(safe-area-inset-bottom));
  z-index: 15;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-top: 1px solid var(--border);
}
.fussleiste__text {
  font-size: var(--fs-14);
  font-weight: var(--fw-medium);
  color: var(--fg);
}
</style>
