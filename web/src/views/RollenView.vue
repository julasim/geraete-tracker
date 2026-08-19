<script setup lang="ts">
/**
 * Rollen und ihre Rechte.
 *
 * Der Katalog kommt vom Server (`GET /rechte`) — er wird hier nicht noch
 * einmal hingeschrieben. Sonst hätte man zwei Listen, die auseinanderlaufen,
 * sobald ein Recht dazukommt.
 *
 * Die drei mitgelieferten Rollen lassen ihre Rechte nicht ändern. Das ist
 * kein Schönheitsfehler, sondern die zweite Hälfte des Aussperr-Schutzes:
 * Ohne diese Sperre könnte man der Verwaltung das Recht `benutzer.verwalten`
 * nehmen und käme über einen Umweg nie mehr an diese Ansicht.
 */
import { onMounted, ref } from "vue";
import { api, ApiError } from "@/api";
import type { RechteKatalog, Rolle } from "@/typen";
import Kopf from "@/components/Kopf.vue";

const rollen = ref<Rolle[]>([]);
const katalog = ref<RechteKatalog | null>(null);
const laedt = ref(true);
const fehler = ref<string | null>(null);
const hinweis = ref<string | null>(null);

/** Welche Rolle ist gerade aufgeklappt. */
const offen = ref<string | null>(null);
const speichert = ref(false);

/** Der Bearbeitungsstand der offenen Rolle — erst beim Speichern übernommen. */
const entwurf = ref<{ name: string; beschreibung: string; rechte: string[] } | null>(null);

// Anlegen
const neuOffen = ref(false);
const neuId = ref("");
const neuName = ref("");

/** Text und Erklärung zu einem Recht — aus dem Katalog des Servers. */
function titel(recht: string) {
  return katalog.value?.rechte.find((x) => x.id === recht);
}

async function laden(): Promise<void> {
  try {
    const [r, k] = await Promise.all([
      api.get<Rolle[]>("/rollen"),
      api.get<RechteKatalog>("/rechte"),
    ]);
    rollen.value = r;
    katalog.value = k;
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht laden";
  } finally {
    laedt.value = false;
  }
}

function umschalten(r: Rolle): void {
  if (offen.value === r.id) {
    offen.value = null;
    entwurf.value = null;
    return;
  }
  offen.value = r.id;
  entwurf.value = {
    name: r.name,
    beschreibung: r.beschreibung ?? "",
    rechte: [...r.rechte],
  };
  hinweis.value = null;
}

function rechtUmschalten(recht: string): void {
  if (!entwurf.value) return;
  const i = entwurf.value.rechte.indexOf(recht);
  if (i === -1) entwurf.value.rechte.push(recht);
  else entwurf.value.rechte.splice(i, 1);
}

async function speichern(r: Rolle): Promise<void> {
  if (!entwurf.value || speichert.value) return;
  speichert.value = true;
  fehler.value = null;
  hinweis.value = null;
  try {
    // Bei mitgelieferten Rollen schickt die Oberfläche die Rechte gar nicht
    // erst mit — der Server würde sie ohnehin mit 409 abweisen.
    await api.patch(`/rollen/${r.id}`, {
      name: entwurf.value.name,
      beschreibung: entwurf.value.beschreibung || null,
      ...(r.ist_vorgabe ? {} : { rechte: entwurf.value.rechte }),
    });
    hinweis.value = "Gespeichert. Rechteänderungen wirken sofort.";
    await laden();
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Speichern fehlgeschlagen";
  } finally {
    speichert.value = false;
  }
}

async function anlegen(): Promise<void> {
  fehler.value = null;
  try {
    await api.post("/rollen", {
      id: neuId.value.trim().toLowerCase(),
      name: neuName.value.trim(),
      rechte: [],
    });
    neuOffen.value = false;
    neuId.value = "";
    neuName.value = "";
    hinweis.value = "Rolle angelegt — jetzt die Rechte setzen.";
    await laden();
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Anlegen fehlgeschlagen";
  }
}

async function loeschen(r: Rolle): Promise<void> {
  if (!confirm(`Rolle "${r.name}" löschen?`)) return;
  fehler.value = null;
  try {
    await api.delete(`/rollen/${r.id}`);
    offen.value = null;
    await laden();
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Löschen fehlgeschlagen";
  }
}

onMounted(laden);
</script>

<template>
  <div>
    <Kopf titel="Rollen und Rechte" zurueck :unter="`${rollen.length} Rollen`" />

    <div class="inhalt">
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>
      <template v-else>
        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>
        <p v-if="hinweis" class="pt-meldung">{{ hinweis }}</p>

        <p class="pt-gedaempft erklaerung">
          Lesen ist kein Recht: Wer angemeldet ist, sieht den ganzen Bestand. Die
          Häkchen entscheiden nur darüber, wer etwas <strong>ändern</strong> darf.
        </p>

        <ul class="pt-liste liste">
          <li v-for="r in rollen" :key="r.id">
            <button class="pt-zeile" :aria-expanded="offen === r.id" @click="umschalten(r)">
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ r.name }}</div>
                <div class="pt-zeile__unter">
                  {{ r.rechte.length }} Recht{{ r.rechte.length === 1 ? "" : "e" }} ·
                  {{ r.anzahl_benutzer ?? 0 }} Konto{{ r.anzahl_benutzer === 1 ? "" : "en" }}
                  <template v-if="r.ist_vorgabe"> · mitgeliefert</template>
                </div>
              </div>
              <span class="zeichen">{{ offen === r.id ? "−" : "+" }}</span>
            </button>

            <div v-if="offen === r.id && entwurf" class="aufklappen">
              <div class="feldgruppe">
                <label class="pt-label" :for="`name-${r.id}`">Anzeigename</label>
                <input :id="`name-${r.id}`" v-model="entwurf.name" class="pt-feld" type="text" />
              </div>

              <div class="feldgruppe">
                <label class="pt-label" :for="`besch-${r.id}`">Beschreibung</label>
                <input
                  :id="`besch-${r.id}`"
                  v-model="entwurf.beschreibung"
                  class="pt-feld"
                  type="text"
                  placeholder="Wofür ist diese Rolle gedacht?"
                />
              </div>

              <p v-if="r.ist_vorgabe" class="pt-meldung sperrhinweis">
                Die Rechte der mitgelieferten Rollen sind fest. Für eine andere
                Zusammenstellung legen Sie unten eine eigene Rolle an.
              </p>

              <div v-for="g in katalog?.gruppen ?? []" :key="g.gruppe" class="gruppe">
                <h3 class="pt-mikro">{{ g.gruppe }}</h3>
                <label
                  v-for="recht in g.rechte"
                  :key="recht"
                  class="haken"
                  :class="{ 'haken--aus': r.ist_vorgabe }"
                >
                  <input
                    type="checkbox"
                    :checked="entwurf.rechte.includes(recht)"
                    :disabled="r.ist_vorgabe"
                    @change="rechtUmschalten(recht)"
                  />
                  <span>
                    <strong>{{ titel(recht)?.titel ?? recht }}</strong>
                    <small>{{ titel(recht)?.erklaerung ?? "" }}</small>
                  </span>
                </label>
              </div>

              <div class="knoepfe">
                <button
                  class="pt-btn pt-btn--primaer pt-btn--breit"
                  :disabled="speichert"
                  @click="speichern(r)"
                >
                  {{ speichert ? "Wird gespeichert …" : "Speichern" }}
                </button>
                <button
                  v-if="!r.ist_vorgabe && !r.anzahl_benutzer"
                  class="pt-btn pt-btn--breit"
                  @click="loeschen(r)"
                >
                  Rolle löschen
                </button>
              </div>
            </div>
          </li>
        </ul>

        <!-- ── Eigene Rolle ─────────────────────────────────── -->
        <div class="pt-karte neu">
          <template v-if="!neuOffen">
            <button class="pt-btn pt-btn--breit" @click="neuOffen = true">
              Eigene Rolle anlegen
            </button>
            <p class="pt-gedaempft neu__hinweis">
              So entsteht etwa eine reine Leserolle: anlegen, kein Häkchen setzen.
            </p>
          </template>

          <template v-else>
            <div class="feldgruppe">
              <label class="pt-label" for="neu-id">Kennung</label>
              <input
                id="neu-id"
                v-model="neuId"
                class="pt-feld"
                type="text"
                autocapitalize="off"
                spellcheck="false"
                placeholder="z. B. buchhaltung"
              />
              <p class="pt-gedaempft feldgruppe__hinweis">
                Kleinbuchstaben ohne Leerzeichen. Sie steht später in den Daten und
                lässt sich nicht ändern.
              </p>
            </div>
            <div class="feldgruppe">
              <label class="pt-label" for="neu-name">Anzeigename</label>
              <input
                id="neu-name"
                v-model="neuName"
                class="pt-feld"
                type="text"
                placeholder="z. B. Buchhaltung"
              />
            </div>
            <div class="knoepfe">
              <button
                class="pt-btn pt-btn--primaer pt-btn--breit"
                :disabled="!neuId.trim() || !neuName.trim()"
                @click="anlegen"
              >
                Anlegen
              </button>
              <button class="pt-btn pt-btn--breit" @click="neuOffen = false">Abbrechen</button>
            </div>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.inhalt {
  padding-bottom: var(--space-6);
}

.erklaerung {
  padding: var(--space-4) var(--space-4) 0;
  font-size: var(--fs-13);
}

.liste {
  margin-top: var(--space-4);
  background: var(--surface);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}

.zeichen {
  font-size: var(--fs-20);
  color: var(--fg-muted);
}

.aufklappen {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--surface-subtle);
  border-top: 1px solid var(--hairline);
}

.feldgruppe {
  display: flex;
  flex-direction: column;
}
.feldgruppe__hinweis {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
}

.sperrhinweis {
  font-size: var(--fs-13);
}

.gruppe h3 {
  margin-bottom: var(--space-2);
}

.haken {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--hairline);
  cursor: pointer;
}
.haken--aus {
  opacity: 0.6;
  cursor: not-allowed;
}
.haken input {
  width: 22px;
  height: 22px;
  margin: 0;
  flex: none;
}
.haken small {
  display: block;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.knoepfe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.neu {
  margin: var(--space-4);
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.neu__hinweis {
  font-size: var(--fs-13);
}
</style>
