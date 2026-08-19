<script setup lang="ts">
/** Übersicht, Konto, Einstellungen. */
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { api } from "@/api";
import { useAnmeldung } from "@/stores/anmeldung";
import { useBestand } from "@/stores/bestand";
import type { OffeneAusgabe } from "@/typen";
import Kopf from "@/components/Kopf.vue";

const anmeldung = useAnmeldung();
const bestand = useBestand();
const router = useRouter();

const offene = ref<OffeneAusgabe[]>([]);
const dunkel = ref(document.documentElement.classList.contains("dunkel"));

const ueberfaellig = computed(() => offene.value.filter((o) => o.ueberfaellig));

onMounted(async () => {
  await bestand.laden();
  try {
    offene.value = await api.get<OffeneAusgabe[]>("/buchungen/offen");
  } catch {
    // Die Übersicht ist Beiwerk — sie darf die Seite nicht kaputt machen.
  }
});

function themaUmschalten(): void {
  dunkel.value = !dunkel.value;
  document.documentElement.classList.toggle("dunkel", dunkel.value);
  document.documentElement.classList.toggle("hell", !dunkel.value);
  localStorage.setItem("gt-thema", dunkel.value ? "dunkel" : "hell");
}

async function abmelden(): Promise<void> {
  await anmeldung.abmelden();
  bestand.leeren();
  await router.replace("/anmelden");
}
</script>

<template>
  <div>
    <Kopf titel="Mehr" :unter="anmeldung.benutzer?.anzeigename" />

    <div class="inhalt">
      <div class="zahlen">
        <div class="zahl">
          <span class="zahl__wert">{{ bestand.zahlen.gesamt }}</span>
          <span class="zahl__text">Geräte</span>
        </div>
        <div class="zahl">
          <span class="zahl__wert">{{ bestand.zahlen.ausgegeben }}</span>
          <span class="zahl__text">ausgegeben</span>
        </div>
        <div class="zahl">
          <span class="zahl__wert">{{ bestand.zahlen.defekt }}</span>
          <span class="zahl__text">defekt</span>
        </div>
        <div class="zahl" :class="{ 'zahl--warnung': ueberfaellig.length > 0 }">
          <span class="zahl__wert">{{ ueberfaellig.length }}</span>
          <span class="zahl__text">überfällig</span>
        </div>
      </div>

      <section v-if="offene.length">
        <h2 class="pt-mikro abschnitt">Derzeit draußen</h2>
        <ul class="pt-karte pt-liste">
          <li v-for="o in offene.slice(0, 12)" :key="o.geraet_id">
            <RouterLink :to="`/geraete/${o.geraet_id}`" class="pt-zeile">
              <div class="pt-zeile__haupt">
                <div class="pt-zeile__titel">{{ o.bezeichnung }}</div>
                <div class="pt-zeile__unter">
                  {{ o.standort }}<template v-if="o.empfaenger"> · {{ o.empfaenger }}</template>
                </div>
              </div>
              <span class="pt-chip" :class="o.ueberfaellig ? 'pt-chip--defekt' : 'pt-chip--neutral'">
                {{ o.tage }} T
              </span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section v-if="anmeldung.darf('geraete.pflegen') || anmeldung.istVerwaltung">
        <h2 class="pt-mikro abschnitt">Verwaltung</h2>
        <div class="pt-karte">
          <ul class="pt-liste">
            <li v-if="anmeldung.darf('geraete.pflegen')">
              <button class="pt-zeile" @click="router.push('/geraete/neu')">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Gerät anlegen</div>
                  <div class="pt-zeile__unter">einzeln erfassen, eines nach dem anderen</div>
                </div>
              </button>
            </li>
            <li v-if="anmeldung.darf('daten.austauschen')">
              <button class="pt-zeile" @click="router.push('/austausch')">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Import und Export</div>
                  <div class="pt-zeile__unter">Bestand als Tabelle aus- und einlesen</div>
                </div>
              </button>
            </li>
            <li v-if="anmeldung.darf('etiketten.drucken')">
              <button class="pt-zeile" @click="router.push('/etiketten')">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Etiketten drucken</div>
                  <div class="pt-zeile__unter">Barcode-Etiketten für neue Geräte</div>
                </div>
              </button>
            </li>
            <li v-if="anmeldung.istVerwaltung">
              <button class="pt-zeile" @click="router.push('/benutzer')">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Benutzer und Rollen</div>
                  <div class="pt-zeile__unter">Konten anlegen, Berechtigungen vergeben</div>
                </div>
              </button>
            </li>
          </ul>
        </div>
      </section>

      <section>
        <h2 class="pt-mikro abschnitt">Konto</h2>
        <div class="pt-karte">
          <ul class="pt-liste">
            <li>
              <button class="pt-zeile" @click="router.push('/passwort')">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Passwort ändern</div>
                </div>
              </button>
            </li>
            <li>
              <button class="pt-zeile" @click="themaUmschalten">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Dunkle Darstellung</div>
                  <div class="pt-zeile__unter">{{ dunkel ? "an" : "aus" }}</div>
                </div>
              </button>
            </li>
            <li>
              <button class="pt-zeile" @click="abmelden">
                <div class="pt-zeile__haupt">
                  <div class="pt-zeile__titel">Abmelden</div>
                </div>
              </button>
            </li>
          </ul>
        </div>
      </section>

      <p class="fuss">
        Angemeldet als {{ anmeldung.benutzer?.benutzername }}
        ({{ anmeldung.benutzer?.rolle ?? "" }})
      </p>
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

.zahlen {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-2);
}
.zahl {
  padding: var(--space-3) var(--space-2);
  text-align: center;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
}
.zahl__wert {
  display: block;
  font-size: var(--fs-24);
  font-weight: var(--fw-semibold);
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--tracking-tight);
  color: var(--fg);
}
.zahl__text {
  font-size: var(--fs-11);
  color: var(--fg-muted);
}
.zahl--warnung .zahl__wert {
  color: var(--danger-fg);
}

.abschnitt {
  margin-bottom: var(--space-2);
}

.fuss {
  font-size: var(--fs-12);
  color: var(--fg-subtle);
  text-align: center;
}
</style>
