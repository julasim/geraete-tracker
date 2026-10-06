<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, ApiError } from "@/api";
import type { BenutzerKurz, LogbuchZeile } from "@/typen";
import Kopf from "@/components/Kopf.vue";

const eintraege = ref<LogbuchZeile[]>([]);
const gesamt = ref(0);
const laedt = ref(true);
const fehler = ref<string | null>(null);

const bereiche = ref<string[]>([]);
const benutzerListe = ref<BenutzerKurz[]>([]);

const filterBereich = ref("");
const filterBenutzer = ref("");
const seite = ref(0);
const PRO_SEITE = 50;

const seiten = computed(() => Math.max(1, Math.ceil(gesamt.value / PRO_SEITE)));

const BEREICH_TEXT: Record<string, string> = {
  geraet: "Gerät",
  buchung: "Buchung",
  schlagwort: "Schlagwort",
  standort: "Standort",
  lagerplatz: "Lagerplatz",
  benutzer: "Benutzer",
  rolle: "Rolle",
  pruefart: "Prüfart",
  pruefung: "Prüfung",
  schaden: "Schaden",
  datei: "Datei",
  paket: "Paket",
  import: "Import",
  etikett: "Etikett",
  auth: "Anmeldung",
};

const AKTION_TEXT: Record<string, string> = {
  angelegt: "angelegt",
  geaendert: "geändert",
  geloescht: "gelöscht",
  ausgemustert: "ausgemustert",
  barcode_hinzugefuegt: "Barcode hinzugefügt",
  barcode_entfernt: "Barcode entfernt",
  gebucht: "gebucht",
  sammelgebucht: "Sammelbuchung",
  ruecknahme_defekt: "Rücknahme mit Defekt",
  korrektur: "Korrektur",
  hochgeladen: "hochgeladen",
  titelbild_gesetzt: "als Titelbild gesetzt",
  angemeldet: "angemeldet",
  abgemeldet: "abgemeldet",
  passwort_geaendert: "Passwort geändert",
  passwort_zurueckgesetzt: "Passwort zurückgesetzt",
  vorrat_reserviert: "Vorrat reserviert",
  altbestand_eingetragen: "Altbestand eingetragen",
  geraete_importiert: "Geräte importiert",
  paket_importiert: "Paket importiert",
};

function bereichText(b: string): string {
  return BEREICH_TEXT[b] ?? b;
}

function aktionText(a: string): string {
  return AKTION_TEXT[a] ?? a;
}

function zeitpunkt(iso: string): string {
  return new Date(iso).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function detailsText(d: Record<string, unknown> | null): string {
  if (!d) return "";
  const teile: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      teile.push(`${k}: ${v.join(", ")}`);
    } else {
      teile.push(`${k}: ${v}`);
    }
  }
  return teile.join(" · ");
}

async function laden(): Promise<void> {
  laedt.value = true;
  fehler.value = null;
  try {
    const params = new URLSearchParams();
    if (filterBereich.value) params.set("bereich", filterBereich.value);
    if (filterBenutzer.value) params.set("benutzer_id", filterBenutzer.value);
    params.set("limit", String(PRO_SEITE));
    params.set("offset", String(seite.value * PRO_SEITE));
    const qs = params.toString();
    const ergebnis = await api.get<{ eintraege: LogbuchZeile[]; gesamt: number }>(
      `/logbuch${qs ? `?${qs}` : ""}`,
    );
    eintraege.value = ergebnis.eintraege;
    gesamt.value = ergebnis.gesamt;
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht geladen werden";
  } finally {
    laedt.value = false;
  }
}

async function ladeMetadaten(): Promise<void> {
  try {
    const [b, ben] = await Promise.all([
      api.get<string[]>("/logbuch/bereiche"),
      api.get<BenutzerKurz[]>("/benutzer"),
    ]);
    bereiche.value = b;
    benutzerListe.value = ben;
  } catch {
    // Filterauswahl ist Beiwerk
  }
}

watch([filterBereich, filterBenutzer], () => {
  seite.value = 0;
  void laden();
});

watch(seite, () => void laden());

onMounted(async () => {
  await Promise.all([laden(), ladeMetadaten()]);
});
</script>

<template>
  <div>
    <Kopf
      titel="Logbuch"
      :unter="gesamt ? `${gesamt} Einträge` : ''"
    />

    <div class="inhalt">
      <div class="filter">
        <select v-model="filterBereich" class="pt-feld filter__feld">
          <option value="">Alle Bereiche</option>
          <option v-for="b in bereiche" :key="b" :value="b">{{ bereichText(b) }}</option>
        </select>
        <select v-model="filterBenutzer" class="pt-feld filter__feld">
          <option value="">Alle Benutzer</option>
          <option v-for="b in benutzerListe" :key="b.id" :value="b.id">
            {{ b.anzeigename }}
          </option>
        </select>
      </div>

      <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <p v-if="!laedt && !eintraege.length && !fehler" class="leer">
        Keine Einträge{{ filterBereich || filterBenutzer ? " für diese Auswahl" : "" }}.
      </p>

      <div v-if="eintraege.length" class="pt-karte">
        <ul class="pt-liste">
          <li v-for="e in eintraege" :key="e.id">
            <div class="zeile">
              <div class="zeile__kopf">
                <span class="zeile__zeit">{{ zeitpunkt(e.zeitpunkt) }}</span>
                <span class="pt-chip pt-chip--neutral zeile__bereich">{{ bereichText(e.bereich) }}</span>
              </div>
              <div class="zeile__haupt">
                <span class="zeile__person">{{ e.anzeigename }}</span>
                <span class="zeile__aktion">{{ aktionText(e.aktion) }}</span>
                <span v-if="e.ziel_text" class="zeile__ziel">{{ e.ziel_text }}</span>
              </div>
              <div v-if="e.details" class="zeile__details">{{ detailsText(e.details) }}</div>
            </div>
          </li>
        </ul>
      </div>

      <div v-if="seiten > 1" class="paginierung">
        <button
          class="pt-btn pt-btn--still"
          :disabled="seite === 0"
          @click="seite--"
        >
          Zurück
        </button>
        <span class="paginierung__stand">
          {{ seite + 1 }} / {{ seiten }}
        </span>
        <button
          class="pt-btn pt-btn--still"
          :disabled="seite >= seiten - 1"
          @click="seite++"
        >
          Weiter
        </button>
      </div>
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

.filter {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.filter__feld {
  flex: 1;
  min-width: 140px;
  max-width: 260px;
}

.leer {
  text-align: center;
  color: var(--fg-muted);
  padding: var(--space-6) 0;
}

.zeile {
  padding: var(--space-3) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.zeile__kopf {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.zeile__zeit {
  font-size: var(--fs-11);
  color: var(--fg-subtle);
  font-variant-numeric: tabular-nums;
}

.zeile__bereich {
  font-size: var(--fs-11);
}

.zeile__haupt {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: wrap;
  font-size: var(--fs-13);
}

.zeile__person {
  font-weight: var(--fw-semibold);
  color: var(--fg);
}

.zeile__aktion {
  color: var(--fg-muted);
}

.zeile__ziel {
  color: var(--fg);
}

.zeile__details {
  font-size: var(--fs-11);
  color: var(--fg-subtle);
  word-break: break-all;
}

.paginierung {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
}

.paginierung__stand {
  font-size: var(--fs-13);
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}
</style>
