<script setup lang="ts">
/**
 * Gerät bearbeiten.
 *
 * Stammdaten, Schlagworte, Zubehör-Zuordnung, Etiketten, Ausmustern.
 * NICHT hier: Standort und Zustand — die entstehen aus Buchungen.
 *
 * Der Konfliktschutz über `rev` greift beim Speichern: Hat jemand anderes
 * inzwischen gespeichert, kommt eine Meldung mit dem aktuellen Stand statt
 * eines stillen Überschreibens.
 *
 * **Die Ansicht verlangt `geraete.pflegen`, das Ausmustern ein zweites,
 * folgenreicheres Recht.** Wer hier hereinkommt, darf also nicht
 * zwangsläufig alles, was hier steht — die mitgelieferte Rolle „Lager und
 * Werkstatt" ist genau dieser Fall.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { Geraet } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import StatusChip from "@/components/StatusChip.vue";

const route = useRoute();
const router = useRouter();
const anmeldung = useAnmeldung();
const bestand = useBestand();
const id = route.params.id as string;

/**
 * Ausmustern ist keine Stammdatenpflege.
 *
 * `POST /geraete/:id/ausmustern` verlangt `geraete.ausmustern` — bis AP25
 * stand der Knopf ohne jede Prüfung da. „Lager und Werkstatt" bestätigte
 * also „Gerät ausmustern?", und danach passierte nichts.
 */
const darfAusmustern = computed(() => anmeldung.darf("geraete.ausmustern"));

const geraet = ref<Geraet | null>(null);
const barcodes = ref<{ barcode: string; aktiv: boolean }[]>([]);
const laedt = ref(true);
const speichert = ref(false);
const fehler = ref<string | null>(null);
const konflikt = ref<{ meldung: string; aktuell: Geraet } | null>(null);
const gespeichert = ref(false);

const bezeichnung = ref("");
const hersteller = ref("");
const modell = ref("");
const seriennummer = ref("");
const notiz = ref("");
const betriebsstunden = ref("");
const gehoertZu = ref("");
const gewaehlteWorte = ref<string[]>([]);

const neuerBarcode = ref("");

/** Kandidaten für die Zubehör-Zuordnung: alles außer sich selbst und dem eigenen Zubehör. */
const moeglicheEltern = computed(() =>
  bestand.geraete.filter((g) => g.id !== id && g.gehoert_zu_id !== id),
);

async function laden(): Promise<void> {
  try {
    await bestand.laden();
    const [g, b] = await Promise.all([
      api.get<Geraet>(`/geraete/${id}`),
      api.get<{ barcode: string; aktiv: boolean }[]>(`/geraete/${id}/barcodes`),
    ]);
    geraet.value = g;
    barcodes.value = b;

    bezeichnung.value = g.bezeichnung;
    hersteller.value = g.hersteller ?? "";
    modell.value = g.modell ?? "";
    seriennummer.value = g.seriennummer ?? "";
    notiz.value = g.notiz ?? "";
    betriebsstunden.value = g.betriebsstunden ?? "";
    gehoertZu.value = g.gehoert_zu_id ?? "";
    gewaehlteWorte.value = g.schlagworte.map((w) => w.id);
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht laden";
  } finally {
    laedt.value = false;
  }
}

function wortUmschalten(wid: string): void {
  const i = gewaehlteWorte.value.indexOf(wid);
  if (i >= 0) gewaehlteWorte.value.splice(i, 1);
  else gewaehlteWorte.value.push(wid);
}

async function speichern(): Promise<void> {
  if (!geraet.value || speichert.value) return;
  speichert.value = true;
  fehler.value = null;
  konflikt.value = null;
  gespeichert.value = false;

  try {
    const geaendert = await api.patch<Geraet>(`/geraete/${id}`, {
      bezeichnung: bezeichnung.value.trim(),
      hersteller: hersteller.value.trim() || null,
      modell: modell.value.trim() || null,
      seriennummer: seriennummer.value.trim() || null,
      notiz: notiz.value.trim() || null,
      betriebsstunden: betriebsstunden.value ? Number(betriebsstunden.value) : null,
      gehoert_zu_id: gehoertZu.value || null,
      schlagworte: gewaehlteWorte.value,
      rev: geraet.value.rev,
    });
    geraet.value = geaendert;
    bestand.ersetze(geaendert);
    gespeichert.value = true;
  } catch (f) {
    if (f instanceof ApiError && f.istKonflikt) {
      // Jemand war schneller. Statt zu überschreiben: zeigen, was jetzt
      // dort steht, und den Benutzer entscheiden lassen.
      konflikt.value = {
        meldung: f.message,
        aktuell: f.body.aktuell as Geraet,
      };
    } else {
      fehler.value = f instanceof ApiError ? f.message : "Konnte nicht gespeichert werden";
    }
  } finally {
    speichert.value = false;
  }
}

async function barcodeErgaenzen(): Promise<void> {
  if (!neuerBarcode.value.trim()) return;
  try {
    await api.post(`/geraete/${id}/barcodes`, { barcode: neuerBarcode.value.trim() });
    neuerBarcode.value = "";
    barcodes.value = await api.get(`/geraete/${id}/barcodes`);
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Etikett konnte nicht ergänzt werden";
  }
}

async function barcodeStilllegen(code: string): Promise<void> {
  if (!confirm(`Etikett ${code} stilllegen? Das Gerät ist danach über diese Nummer nicht mehr auffindbar.`)) return;
  try {
    await api.delete(`/geraete/${id}/barcodes/${encodeURIComponent(code)}`);
    barcodes.value = await api.get(`/geraete/${id}/barcodes`);
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Etikett konnte nicht stillgelegt werden";
  }
}

async function ausmustern(): Promise<void> {
  if (!confirm("Gerät ausmustern? Es verschwindet aus den Listen, bleibt aber mit seiner Historie erhalten.")) return;
  try {
    const aus = await api.post<Geraet>(`/geraete/${id}/ausmustern`);
    bestand.ersetze(aus);
    await router.push("/geraete");
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht ausgemustert werden";
  }
}

onMounted(laden);
</script>

<template>
  <div>
    <Kopf titel="Bearbeiten" zurueck :unter="geraet?.inventarnummer ?? ''" />

    <div class="inhalt">
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>
      <p v-else-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <template v-if="geraet">
        <!-- Konflikt: zeigt beide Stände, damit man sieht was passiert ist -->
        <div v-if="konflikt" class="pt-meldung pt-meldung--warnung konflikt">
          <p><strong>{{ konflikt.meldung }}</strong></p>
          <p class="konflikt__stand">
            Dort steht jetzt: <strong>{{ konflikt.aktuell.bezeichnung }}</strong>
            <template v-if="konflikt.aktuell.hersteller">
              · {{ konflikt.aktuell.hersteller }}
            </template>
          </p>
          <button class="pt-btn konflikt__knopf" @click="laden">
            Aktuellen Stand laden (eigene Änderungen verwerfen)
          </button>
        </div>

        <p v-if="gespeichert" class="pt-meldung pt-meldung--erfolg">Gespeichert.</p>

        <div class="feld">
          <label class="pt-label" for="bez">Bezeichnung</label>
          <input id="bez" v-model="bezeichnung" class="pt-feld" type="text" />
        </div>

        <div class="zwei">
          <div class="feld">
            <label class="pt-label" for="herst">Hersteller</label>
            <input id="herst" v-model="hersteller" class="pt-feld" type="text" />
          </div>
          <div class="feld">
            <label class="pt-label" for="mod">Modell</label>
            <input id="mod" v-model="modell" class="pt-feld" type="text" />
          </div>
        </div>

        <div class="zwei">
          <div class="feld">
            <label class="pt-label" for="sn">Seriennummer</label>
            <input id="sn" v-model="seriennummer" class="pt-feld" type="text" />
          </div>
          <div class="feld">
            <label class="pt-label" for="bs">Betriebsstunden</label>
            <input
              id="bs"
              v-model="betriebsstunden"
              class="pt-feld pt-mono"
              type="number"
              inputmode="decimal"
              step="0.1"
              min="0"
            />
          </div>
        </div>

        <div class="feld">
          <label class="pt-label" for="notiz">Notiz</label>
          <input id="notiz" v-model="notiz" class="pt-feld" type="text" />
        </div>

        <div v-if="bestand.schlagworte.length" class="feld">
          <label class="pt-label">Schlagworte</label>
          <div class="worte">
            <button
              v-for="w in bestand.schlagworte"
              :key="w.id"
              class="wort"
              :class="{ 'wort--an': gewaehlteWorte.includes(w.id) }"
              @click="wortUmschalten(w.id)"
            >
              {{ w.name }}
            </button>
          </div>
        </div>

        <div class="feld">
          <label class="pt-label" for="eltern">Gehört als Zubehör zu</label>
          <select id="eltern" v-model="gehoertZu" class="pt-feld">
            <option value="">— eigenständiges Gerät —</option>
            <option v-for="g in moeglicheEltern" :key="g.id" :value="g.id">
              {{ g.bezeichnung }} ({{ g.inventarnummer }})
            </option>
          </select>
          <p class="hinweis">
            Zubehör bleibt ein eigenes Gerät mit eigenem Etikett und eigener Historie —
            es wird nur zusätzlich beim Hauptgerät angezeigt.
          </p>
        </div>

        <button
          class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
          :disabled="speichert || !bezeichnung.trim()"
          @click="speichern"
        >
          {{ speichert ? "Wird gespeichert …" : "Speichern" }}
        </button>

        <!-- ── Etiketten ──────────────────────────────────── -->
        <section>
          <h2 class="pt-mikro abschnitt">Etiketten</h2>
          <ul class="pt-karte pt-liste">
            <li v-for="b in barcodes" :key="b.barcode">
              <div class="pt-zeile">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel pt-mono">{{ b.barcode }}</div>
                  <div class="pt-zeile__unter">{{ b.aktiv ? "gültig" : "stillgelegt" }}</div>
                </div>
                <button
                  v-if="b.aktiv"
                  class="pt-btn kleinknopf"
                  @click="barcodeStilllegen(b.barcode)"
                >
                  Stilllegen
                </button>
              </div>
            </li>
          </ul>

          <div class="hand">
            <input
              v-model="neuerBarcode"
              class="pt-feld pt-mono"
              type="text"
              inputmode="numeric"
              placeholder="Ersatzetikett-Nummer"
              @keyup.enter="barcodeErgaenzen"
            />
            <button class="pt-btn" :disabled="!neuerBarcode.trim()" @click="barcodeErgaenzen">
              Ergänzen
            </button>
          </div>
          <p class="hinweis">
            Ein Gerät darf mehrere Etiketten tragen. Wird eines unleserlich, klebt man ein
            neues daneben — bis das alte abfällt, funktionieren beide.
          </p>
        </section>

        <!-- ── Ausmustern ─────────────────────────────────── -->
        <section v-if="darfAusmustern">
          <h2 class="pt-mikro abschnitt">Aus dem Bestand nehmen</h2>
          <div class="pt-karte ausmustern">
            <div>
              <StatusChip :status="geraet.status" />
              <p class="hinweis">
                Ausgemusterte Geräte verschwinden aus den Listen, bleiben aber mit ihrer
                vollständigen Historie erhalten. Gelöscht wird nichts.
              </p>
            </div>
            <button
              class="pt-btn pt-btn--breit"
              :disabled="geraet.status === 'ausgemustert'"
              @click="ausmustern"
            >
              {{ geraet.status === "ausgemustert" ? "Bereits ausgemustert" : "Ausmustern" }}
            </button>
          </div>
        </section>
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

.feld {
  display: flex;
  flex-direction: column;
}
.zwei {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.hinweis {
  margin-top: var(--space-2);
  font-size: var(--fs-13);
  line-height: var(--lh-normal);
  color: var(--fg-muted);
}

.worte {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.wort {
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-13);
  font-weight: var(--fw-medium);
  color: var(--fg-muted);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-full);
  cursor: pointer;
}
.wort--an {
  color: var(--accent-fg);
  background: var(--accent);
  border-color: var(--accent);
}

.konflikt__stand {
  margin-top: var(--space-2);
}
.konflikt__knopf {
  margin-top: var(--space-3);
  min-height: 40px;
  font-size: var(--fs-13);
}

.abschnitt {
  margin-bottom: var(--space-2);
}

.kleinknopf {
  min-height: 36px;
  padding: 0 var(--space-3);
  font-size: var(--fs-13);
}

.hand {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
.hand .pt-feld {
  flex: 1;
}

.ausmustern {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
}
</style>
