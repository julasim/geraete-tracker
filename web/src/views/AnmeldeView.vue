<script setup lang="ts">
import { ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";

const anmeldung = useAnmeldung();
const router = useRouter();
const route = useRoute();

const kennung = ref("");
const passwort = ref("");
const laeuft = ref(false);
const fehler = ref<string | null>(null);

async function absenden(): Promise<void> {
  if (laeuft.value) return;
  laeuft.value = true;
  fehler.value = null;
  try {
    await anmeldung.anmelden(kennung.value, passwort.value);
    const ziel = (route.query.weiter as string) || "/scan";
    await router.replace(ziel);
  } catch (f) {
    // Der Server unterscheidet bewusst nicht, ob das Konto existiert oder
    // nur das Passwort falsch war. Diese Meldung wird hier unverändert
    // durchgereicht — jede Ergänzung würde den Schutz aushebeln.
    fehler.value = f instanceof ApiError ? f.message : "Anmeldung fehlgeschlagen";
  } finally {
    laeuft.value = false;
  }
}
</script>

<template>
  <div class="seite">
    <div class="kasten">
      <div class="marke">
        <p class="pt-mikro">Geräte</p>
        <h1 class="marke__titel">Anmelden</h1>
      </div>

      <form @submit.prevent="absenden">
        <div class="feld">
          <label class="pt-label" for="kennung">Benutzername oder E-Mail</label>
          <input
            id="kennung"
            v-model="kennung"
            class="pt-feld"
            type="text"
            autocomplete="username"
            autocapitalize="off"
            spellcheck="false"
            required
          />
        </div>

        <div class="feld">
          <label class="pt-label" for="passwort">Passwort</label>
          <input
            id="passwort"
            v-model="passwort"
            class="pt-feld"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <button
          class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
          type="submit"
          :disabled="laeuft || !kennung || !passwort"
        >
          {{ laeuft ? "Wird geprüft …" : "Anmelden" }}
        </button>
      </form>

      <p class="hinweis">
        Passwort vergessen? Die Verwaltung setzt es zurück — aus Sicherheitsgründen
        gibt es keinen Weg per E-Mail.
      </p>
    </div>
  </div>
</template>

<style scoped>
.seite {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  padding: var(--space-4);
  background: var(--surface-subtle);
}

.kasten {
  width: 100%;
  max-width: 380px;
  padding: var(--space-6);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
}

.marke {
  margin-bottom: var(--space-6);
}
.marke__titel {
  font-size: var(--fs-24);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
}

.feld {
  margin-bottom: var(--space-4);
}

.hinweis {
  margin-top: var(--space-5);
  font-size: var(--fs-13);
  line-height: var(--lh-normal);
  color: var(--fg-muted);
}
</style>
