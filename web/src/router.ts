import { createRouter, createWebHistory } from "vue-router";
import { useAnmeldung } from "@/stores/anmeldung";

/**
 * Ansichten werden nachgeladen. Der Scanner zieht das WebAssembly-Paket
 * nach sich (rund 1 MB) — das soll nicht beim ersten Öffnen der
 * Anmeldeseite über die Mobilfunkverbindung gehen.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/scan" },
    {
      path: "/anmelden",
      name: "anmelden",
      component: () => import("@/views/AnmeldeView.vue"),
      meta: { ohneAnmeldung: true, ohneShell: true },
    },
    {
      path: "/scan",
      name: "scan",
      component: () => import("@/views/ScanView.vue"),
      meta: { ohneRahmen: true },
    },
    { path: "/geraete", name: "geraete", component: () => import("@/views/GeraeteView.vue") },
    {
      path: "/geraete/neu",
      name: "geraet-neu",
      component: () => import("@/views/GeraetNeuView.vue"),
      meta: { recht: "geraete.pflegen" },
    },
    { path: "/geraete/:id", name: "geraet", component: () => import("@/views/GeraetView.vue") },
    {
      path: "/geraete/:id/bearbeiten",
      name: "geraet-bearbeiten",
      component: () => import("@/views/GeraetBearbeitenView.vue"),
      meta: { recht: "geraete.pflegen" },
    },
    {
      // Sammelbuchung: Die Geräte stehen im Store, nicht im Pfad — eine
      // Liste von zehn UUIDs in der Adresse wäre unlesbar und bei einem
      // Neuladen ohnehin verloren.
      path: "/sammeln/:art",
      name: "sammeln",
      component: () => import("@/views/SammelBuchenView.vue"),
      meta: { recht: "buchungen.erfassen" },
    },
    {
      path: "/buchen/:id/:art",
      name: "buchen",
      component: () => import("@/views/BuchenView.vue"),
    },
    { path: "/orte", name: "orte", component: () => import("@/views/OrteView.vue") },
    // Ohne meta.recht: Lesen ist in dieser Anwendung kein Recht — wer
    // angemeldet ist, darf sehen, was ansteht.
    {
      path: "/pruefungen",
      name: "pruefungen",
      component: () => import("@/views/PruefungenView.vue"),
    },
    { path: "/mehr", name: "mehr", component: () => import("@/views/MehrView.vue") },
    {
      path: "/etiketten",
      name: "etiketten",
      component: () => import("@/views/EtikettenView.vue"),
      meta: { recht: "etiketten.drucken" },
    },
    {
      // Ohne meta.recht: Wer ein Paket ausgeben will, muss sehen, was drin
      // ist. Die Knöpfe zum Ändern erscheinen nur mit stammdaten.pflegen.
      path: "/pakete",
      name: "pakete",
      component: () => import("@/views/PaketeView.vue"),
    },
    {
      // Ohne meta.recht: Die Ansicht zeigt Schlagworte und Prüfarten, und
      // Lesen ist in dieser Anwendung kein Recht. Die Knöpfe zum Ändern
      // erscheinen nur mit stammdaten.pflegen bzw. pruefungen.eintragen —
      // der Server weist es ohnehin ab.
      path: "/stammdaten",
      name: "stammdaten",
      component: () => import("@/views/StammdatenView.vue"),
    },
    {
      path: "/austausch",
      name: "austausch",
      component: () => import("@/views/AustauschView.vue"),
      meta: { recht: "daten.austauschen" },
    },
    {
      path: "/benutzer",
      name: "benutzer",
      component: () => import("@/views/BenutzerView.vue"),
      meta: { recht: "benutzer.verwalten" },
    },
    {
      path: "/benutzer/neu",
      name: "benutzer-neu",
      component: () => import("@/views/BenutzerBearbeitenView.vue"),
      meta: { recht: "benutzer.verwalten" },
    },
    {
      path: "/benutzer/:id",
      name: "benutzer-bearbeiten",
      component: () => import("@/views/BenutzerBearbeitenView.vue"),
      meta: { recht: "benutzer.verwalten" },
    },
    {
      path: "/rollen",
      name: "rollen",
      component: () => import("@/views/RollenView.vue"),
      meta: { recht: "benutzer.verwalten" },
    },
    { path: "/passwort", name: "passwort", component: () => import("@/views/PasswortView.vue") },
    { path: "/:pfad(.*)*", redirect: "/scan" },
  ],
  scrollBehavior: (_zu, _von, gemerkt) => gemerkt ?? { top: 0 },
});

/**
 * Standard ist gesperrt — genau wie auf der Serverseite. Eine Ansicht ist
 * nur ohne Anmeldung erreichbar, wenn sie es ausdrücklich verlangt.
 *
 * Das ist Bequemlichkeit, kein Schutz: Der eigentliche Schutz sitzt im
 * Server. Die Oberfläche erspart dem Benutzer nur, in eine leere Ansicht
 * zu laufen und dort einen 401 zu sehen.
 */
router.beforeEach(async (zu) => {
  const anmeldung = useAnmeldung();

  if (!anmeldung.geprueft) await anmeldung.pruefe();

  if (zu.meta.ohneAnmeldung) {
    return anmeldung.angemeldet ? { path: "/scan" } : true;
  }

  if (!anmeldung.angemeldet) {
    return { path: "/anmelden", query: zu.fullPath !== "/" ? { weiter: zu.fullPath } : {} };
  }

  // Wer ein Einmalpasswort bekommen hat, muss es zuerst ändern.
  if (anmeldung.passwortWechselNoetig && zu.path !== "/passwort") {
    return { path: "/passwort" };
  }

  // Ansichten, für die das Recht fehlt, gar nicht erst öffnen. Das ist
  // Bequemlichkeit, kein Schutz — der sitzt im Server, der jede dieser
  // Routen ohnehin mit 403 abweist.
  const verlangt = zu.meta.recht as string | undefined;
  if (verlangt && !anmeldung.darf(verlangt)) {
    return { path: "/geraete" };
  }

  return true;
});
