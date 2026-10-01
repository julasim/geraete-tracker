<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import Kopf from "@/components/Kopf.vue";

const router = useRouter();
const anmeldung = useAnmeldung();
const alt = ref("");
const neu = ref("");
const wiederholung = ref("");
const laeuft = ref(false);
const fehler = ref<string | null>(null);
const fertig = ref(false);

async function speichern(): Promise<void> {
  fehler.value = null;
  if (neu.value !== wiederholung.value) {
    fehler.value = "Die beiden Eingaben stimmen nicht überein.";
    return;
  }
  laeuft.value = true;
  try {
    await api.post("/auth/passwort", { altesPasswort: alt.value, neuesPasswort: neu.value });
    anmeldung.passwortWechselNoetig = false;
    fertig.value = true;
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht geändert werden";
  } finally {
    laeuft.value = false;
  }
}
</script>

<template>
  <div>
    <Kopf titel="Passwort ändern" zurueck />

    <div class="inhalt">
      <template v-if="fertig">
        <p class="pt-meldung pt-meldung--erfolg">
          Das Passwort wurde geändert. Andere Geräte wurden abgemeldet.
        </p>
        <button class="pt-btn pt-btn--primaer pt-btn--breit" @click="router.push('/mehr')">
          Zurück
        </button>
      </template>

      <template v-else>
        <div class="feld">
          <label class="pt-label" for="alt">Bisheriges Passwort</label>
          <input id="alt" v-model="alt" class="pt-feld" type="password" autocomplete="current-password" />
        </div>

        <div class="feld">
          <label class="pt-label" for="neu">Neues Passwort</label>
          <input id="neu" v-model="neu" class="pt-feld" type="password" autocomplete="new-password" />
          <!-- Länge schlägt Zeichensalat: erzwungene Sonderzeichen enden
               erfahrungsgemäß auf einem Zettel am Bildschirm. -->
          <p class="hinweis">
            Mindestens 12 Zeichen. Am besten mehrere Wörter, die nur Sie verbinden —
            leichter zu merken und schwerer zu raten als ein kurzes kompliziertes.
          </p>
        </div>

        <div class="feld">
          <label class="pt-label" for="wdh">Neues Passwort wiederholen</label>
          <input id="wdh" v-model="wiederholung" class="pt-feld" type="password" autocomplete="new-password" />
        </div>

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <button
          class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
          :disabled="laeuft || !alt || !neu"
          @click="speichern"
        >
          {{ laeuft ? "Wird geprüft …" : "Passwort ändern" }}
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
  gap: var(--space-4);
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
</style>
