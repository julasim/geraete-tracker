<script setup lang="ts">
/**
 * Die Konten im Überblick.
 *
 * Zwei Angaben zählen im Alltag: Wer ist das, und was darf er. Deshalb steht
 * die Rolle in jeder Zeile. Gesperrte und stillgelegte Konten rutschen nach
 * unten — sie sind der seltene Fall.
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import type { BenutzerVoll } from "@/typen";
import Kopf from "@/components/Kopf.vue";
import Symbol from "@/components/Symbol.vue";

const router = useRouter();

const konten = ref<BenutzerVoll[]>([]);
const laedt = ref(true);
const fehler = ref<string | null>(null);

const aktive = computed(() => konten.value.filter((b) => b.aktiv));
const stillgelegte = computed(() => konten.value.filter((b) => !b.aktiv));

/** Ist das Konto gerade wegen zu vieler Fehlversuche gesperrt? */
function gesperrt(b: BenutzerVoll): boolean {
  return b.gesperrt_bis !== null && new Date(b.gesperrt_bis).getTime() > Date.now();
}

function zeit(iso: string | null): string {
  if (!iso) return "noch nie angemeldet";
  return new Date(iso).toLocaleString("de-AT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function laden(): Promise<void> {
  laedt.value = true;
  try {
    konten.value = await api.get<BenutzerVoll[]>("/benutzer");
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht laden";
  } finally {
    laedt.value = false;
  }
}

onMounted(laden);
</script>

<template>
  <div>
    <Kopf titel="Benutzer" :unter="`${aktive.length} aktiv`">
      <template #rechts>
        <button class="pt-btn pt-btn--primaer" @click="router.push('/benutzer/neu')">
          <Symbol name="plus" :groesse="18" />
          Neu
        </button>
      </template>
    </Kopf>

    <div class="inhalt">
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>
      <p v-else-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

      <template v-else>
        <ul class="pt-liste liste">
          <li v-for="b in aktive" :key="b.id">
            <RouterLink :to="`/benutzer/${b.id}`" class="pt-zeile">
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ b.anzeigename }}</div>
                <div class="pt-zeile__unter">
                  {{ b.benutzername }} · zuletzt {{ zeit(b.letzter_login) }}
                </div>
              </div>
              <div class="marken">
                <span v-if="gesperrt(b)" class="pt-chip pt-chip--defekt">gesperrt</span>
                <span v-else-if="b.passwort_wechsel_noetig" class="pt-chip pt-chip--warnung">
                  Passwort offen
                </span>
                <span class="pt-chip pt-chip--neutral">{{ b.rollenname }}</span>
              </div>
            </RouterLink>
          </li>
        </ul>

        <template v-if="stillgelegte.length">
          <h2 class="pt-mikro abschnitt">Stillgelegt</h2>
          <ul class="pt-liste liste">
            <li v-for="b in stillgelegte" :key="b.id">
              <RouterLink :to="`/benutzer/${b.id}`" class="pt-zeile still">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">{{ b.anzeigename }}</div>
                  <div class="pt-zeile__unter">{{ b.benutzername }}</div>
                </div>
                <span class="pt-chip pt-chip--neutral">{{ b.rollenname }}</span>
              </RouterLink>
            </li>
          </ul>
        </template>

        <!-- Rollen sind eine Ebene tiefer: Man verwaltet sie selten, aber
             wenn, dann bewusst. -->
        <ul class="pt-karte pt-liste rollen">
          <li>
            <button class="pt-zeile" @click="router.push('/rollen')">
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">Rollen und Rechte</div>
                <div class="pt-zeile__unter">Festlegen, was eine Rolle darf</div>
              </div>
              <Symbol name="weiter" :groesse="18" />
            </button>
          </li>
        </ul>
      </template>
    </div>
  </div>
</template>

<style scoped>
.inhalt {
  padding-bottom: var(--space-6);
}

.liste {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.abschnitt {
  padding: var(--space-4) var(--space-4) var(--space-2);
}

.still {
  opacity: 0.6;
}

.marken {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  justify-content: flex-end;
}

.rollen {
  margin: var(--space-4);
}
</style>
