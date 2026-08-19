<script setup lang="ts">
/**
 * Konto anlegen und ändern.
 *
 * Das Einmalpasswort ist die heikle Stelle: Es wird vom Server erzeugt, GENAU
 * EINMAL ausgeliefert und nirgends gespeichert. Deshalb steht es hier groß,
 * mit Kopierknopf und einer deutlichen Ansage — wer das Fenster schließt,
 * ohne es weiterzugeben, muss es neu setzen lassen.
 *
 * Zwei Sperren kommen vom Server und stehen bewusst NICHT hier nachgebaut:
 * Am eigenen Konto lassen sich Rolle und Zustand nicht ändern, und das letzte
 * aktive Verwaltungskonto lässt sich nicht entwerten. Die Oberfläche zeigt
 * die Meldung des Servers — so kann sie nicht auseinanderlaufen.
 */
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ApiError } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import type { BenutzerVoll, Rolle } from "@/typen";
import Kopf from "@/components/Kopf.vue";

const route = useRoute();
const router = useRouter();
const anmeldung = useAnmeldung();

const id = computed(() => (route.params.id as string | undefined) ?? null);
const istNeu = computed(() => id.value === null);
const eigenesKonto = computed(() => id.value !== null && id.value === anmeldung.benutzer?.id);

const rollen = ref<Rolle[]>([]);
const laedt = ref(true);
const speichert = ref(false);
const fehler = ref<string | null>(null);
const hinweis = ref<string | null>(null);

const benutzername = ref("");
const anzeigename = ref("");
const email = ref("");
const rolle = ref("mitarbeiter");
const aktiv = ref(true);

/** Das Einmalpasswort — nur im Speicher, nur bis zum Verlassen der Seite. */
const einmalpasswort = ref<string | null>(null);
const kopiert = ref(false);

async function laden(): Promise<void> {
  try {
    rollen.value = await api.get<Rolle[]>("/rollen");
    if (!istNeu.value) {
      const alle = await api.get<BenutzerVoll[]>("/benutzer");
      const b = alle.find((x) => x.id === id.value);
      if (!b) throw new Error("Dieses Konto gibt es nicht (mehr).");
      benutzername.value = b.benutzername;
      anzeigename.value = b.anzeigename;
      email.value = b.email ?? "";
      rolle.value = b.rolle;
      aktiv.value = b.aktiv;
    } else {
      rolle.value = rollen.value[0]?.id ?? "mitarbeiter";
    }
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : (f as Error).message;
  } finally {
    laedt.value = false;
  }
}

async function speichern(): Promise<void> {
  if (speichert.value) return;
  speichert.value = true;
  fehler.value = null;
  hinweis.value = null;
  try {
    if (istNeu.value) {
      const antwort = await api.post<{ benutzer: BenutzerVoll; einmalpasswort: string }>(
        "/benutzer",
        {
          benutzername: benutzername.value.trim(),
          anzeigename: anzeigename.value.trim(),
          email: email.value.trim() || null,
          rolle: rolle.value,
        },
      );
      einmalpasswort.value = antwort.einmalpasswort;
    } else {
      await api.patch(`/benutzer/${id.value}`, {
        anzeigename: anzeigename.value.trim(),
        email: email.value.trim() || null,
        rolle: rolle.value,
        aktiv: aktiv.value,
      });
      hinweis.value = "Gespeichert.";
    }
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Speichern fehlgeschlagen";
  } finally {
    speichert.value = false;
  }
}

async function passwortZuruecksetzen(): Promise<void> {
  if (!confirm("Ein neues Einmalpasswort erzeugen? Das alte gilt dann nicht mehr.")) return;
  fehler.value = null;
  try {
    const antwort = await api.post<{ einmalpasswort: string }>(
      `/benutzer/${id.value}/passwort`,
      {},
    );
    einmalpasswort.value = antwort.einmalpasswort;
  } catch (f) {
    fehler.value = f instanceof ApiError ? f.message : "Konnte nicht zurückgesetzt werden";
  }
}

async function kopieren(): Promise<void> {
  if (!einmalpasswort.value) return;
  try {
    await navigator.clipboard.writeText(einmalpasswort.value);
    kopiert.value = true;
    setTimeout(() => (kopiert.value = false), 2000);
  } catch {
    // Ohne sicheren Kontext gibt es keine Zwischenablage. Dann bleibt der
    // Weg, den es ohnehin meistens ist: vorlesen oder abschreiben.
    fehler.value = "Kopieren ging nicht — bitte abschreiben.";
  }
}

onMounted(laden);
</script>

<template>
  <div>
    <Kopf :titel="istNeu ? 'Konto anlegen' : anzeigename || 'Konto'" zurueck />

    <div class="inhalt">
      <p v-if="laedt" class="pt-leer">Wird geladen …</p>

      <!-- ── Einmalpasswort ────────────────────────────────── -->
      <template v-else-if="einmalpasswort">
        <div class="pt-karte passwort">
          <h2 class="passwort__titel">Einmalpasswort</h2>
          <p class="passwort__wert pt-mono">{{ einmalpasswort }}</p>
          <p class="passwort__hinweis">
            Dieses Passwort wird <strong>nur jetzt</strong> angezeigt. Geben Sie es weiter —
            beim ersten Anmelden muss es geändert werden. Wenn es verloren geht, lässt es
            sich hier neu erzeugen.
          </p>
          <button class="pt-btn pt-btn--breit" @click="kopieren">
            {{ kopiert ? "Kopiert" : "In die Zwischenablage kopieren" }}
          </button>
        </div>

        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>

        <button class="pt-btn pt-btn--primaer pt-btn--breit" @click="router.push('/benutzer')">
          Fertig
        </button>
      </template>

      <!-- ── Formular ──────────────────────────────────────── -->
      <template v-else>
        <p v-if="fehler" class="pt-meldung pt-meldung--fehler">{{ fehler }}</p>
        <p v-if="hinweis" class="pt-meldung">{{ hinweis }}</p>

        <div class="feldgruppe">
          <label class="pt-label" for="benutzername">Benutzername</label>
          <input
            id="benutzername"
            v-model="benutzername"
            class="pt-feld"
            type="text"
            :disabled="!istNeu"
            autocapitalize="off"
            spellcheck="false"
            placeholder="z. B. m.huber"
          />
          <p v-if="!istNeu" class="pt-gedaempft feldgruppe__hinweis">
            Der Benutzername steht in der Historie jeder Buchung und lässt sich
            deshalb nicht ändern.
          </p>
        </div>

        <div class="feldgruppe">
          <label class="pt-label" for="anzeigename">Name</label>
          <input
            id="anzeigename"
            v-model="anzeigename"
            class="pt-feld"
            type="text"
            placeholder="Vor- und Nachname"
          />
        </div>

        <div class="feldgruppe">
          <label class="pt-label" for="email">E-Mail (freiwillig)</label>
          <input
            id="email"
            v-model="email"
            class="pt-feld"
            type="email"
            autocapitalize="off"
            spellcheck="false"
          />
        </div>

        <div class="feldgruppe">
          <label class="pt-label" for="rolle">Rolle</label>
          <select id="rolle" v-model="rolle" class="pt-feld" :disabled="eigenesKonto">
            <option v-for="r in rollen" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
          <p class="pt-gedaempft feldgruppe__hinweis">
            <template v-if="eigenesKonto">
              Am eigenen Konto lassen sich Rolle und Zustand nicht ändern — das soll
              verhindern, dass man sich selbst aussperrt.
            </template>
            <template v-else>
              {{ rollen.find((r) => r.id === rolle)?.beschreibung ?? "" }}
              Ein Rollenwechsel beendet alle Sitzungen des Kontos.
            </template>
          </p>
        </div>

        <div v-if="!istNeu" class="feldgruppe">
          <label class="schalter" :class="{ 'schalter--aus': eigenesKonto }">
            <input v-model="aktiv" type="checkbox" :disabled="eigenesKonto" />
            <span>
              <strong>Konto ist aktiv</strong>
              <small>
                Stillgelegte Konten können sich nicht anmelden, bleiben aber in der
                Historie sichtbar.
              </small>
            </span>
          </label>
        </div>

        <div class="knoepfe">
          <button
            class="pt-btn pt-btn--primaer pt-btn--breit pt-btn--gross"
            :disabled="speichert || !anzeigename.trim() || (istNeu && !benutzername.trim())"
            @click="speichern"
          >
            {{ speichert ? "Wird gespeichert …" : istNeu ? "Konto anlegen" : "Speichern" }}
          </button>
          <button v-if="!istNeu" class="pt-btn pt-btn--breit" @click="passwortZuruecksetzen">
            Passwort zurücksetzen
          </button>
          <button class="pt-btn pt-btn--breit" @click="router.back()">Abbrechen</button>
        </div>
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

.feldgruppe {
  display: flex;
  flex-direction: column;
}
.feldgruppe__hinweis {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
}

.schalter {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
}
.schalter--aus {
  opacity: 0.55;
  cursor: not-allowed;
}
.schalter input {
  width: 24px;
  height: 24px;
  margin: 0;
  flex: none;
}
.schalter small {
  display: block;
  font-size: var(--fs-13);
  color: var(--fg-muted);
}

.knoepfe {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

/* ── Einmalpasswort ─────────────────────────────────────── */
.passwort {
  padding: var(--space-6) var(--space-4);
  text-align: center;
}
.passwort__titel {
  font-size: var(--fs-13);
  font-weight: var(--fw-semibold);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  color: var(--fg-muted);
  margin-bottom: var(--space-3);
}
.passwort__wert {
  font-size: var(--fs-20);
  font-weight: var(--fw-semibold);
  line-height: 1.4;
  color: var(--fg);
  word-break: break-all;
  padding: var(--space-4);
  background: var(--surface-muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.passwort__hinweis {
  margin: var(--space-4) 0;
  font-size: var(--fs-13);
  color: var(--fg-body);
  text-align: left;
}
</style>
