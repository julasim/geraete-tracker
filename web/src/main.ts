import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { meldeAbmeldungAn } from "./api";
import { useAnmeldung } from "./stores/anmeldung";

import "./styles/tokens.css";
import "./styles/basis.css";

/**
 * Das Thema wird VOR dem Aufbau der Oberfläche gesetzt — sonst blitzt beim
 * Laden kurz die helle Darstellung auf, bevor die dunkle greift.
 */
const gemerkt = localStorage.getItem("gt-thema");
if (gemerkt === "dunkel") document.documentElement.classList.add("dunkel");
if (gemerkt === "hell") document.documentElement.classList.add("hell");

const app = createApp(App);
app.use(createPinia());

// Meldet der Server 401, ist die Anmeldung erloschen — dann räumt die
// Oberfläche auf und schickt zur Anmeldeseite, statt leere Listen zu zeigen.
const anmeldung = useAnmeldung();
meldeAbmeldungAn(() => {
  anmeldung.verwerfen();
  if (router.currentRoute.value.path !== "/anmelden") {
    void router.replace({
      path: "/anmelden",
      query: { weiter: router.currentRoute.value.fullPath },
    });
  }
});

app.use(router);
app.mount("#app");
