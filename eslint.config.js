// Was die Typprüfung nicht sieht.
//
// `tsc` und `vue-tsc` fangen Typfehler. ESLint fängt das andere: tote
// Bezeichner, verschluckte Fehler, `any` an Stellen, wo es niemandem
// auffällt, und in den Vue-Dateien Vorlagen, die zwar bauen, aber zur
// Laufzeit nichts anzeigen (fehlendes `:key`, doppelte Attribute).
//
// Aufbau wie in ../patio, damit hier nichts Neues zu lernen ist —
// erweitert um die Vue-Oberfläche, die dort nicht mitgeprüft wird.

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import vue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist/", "web/dist/", "node_modules/", "web/node_modules/", "scanner-test/", "sicherung/"] },

  eslint.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Server, Tests, Werkzeuge ─────────────────────────────────────────────
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    rules: {
      // Ein ungenutzter Parameter ist manchmal Absicht (Signatur einer
      // Schnittstelle). Ein Unterstrich davor sagt: gewollt.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Ein leerer catch-Block ist an genau einer Stelle richtig: wenn der
      // Fehler wirklich egal ist und danebensteht, warum.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  // ── Durchläufe und Bau-Skripte: reines ESM-JavaScript ───────────────────
  // Hier greift `no-undef` (anders als in .ts, wo der Compiler prüft),
  // deshalb müssen die Node-Globals bekannt sein.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
      },
    },
  },

  // ── Vue-Oberfläche ───────────────────────────────────────────────────────
  ...vue.configs["flat/recommended"],
  {
    files: ["web/src/**/*.{ts,vue}"],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: "latest",
        sourceType: "module",
        extraFileExtensions: [".vue"],
      },
      globals: {
        // Der Browser. In den .ts-Dateien des Frontends prüft der Compiler
        // das über lib.dom; für die Vorlagen in .vue braucht ESLint es hier.
        window: "readonly",
        document: "readonly",
        console: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        location: "readonly",
        confirm: "readonly",
        alert: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        URL: "readonly",
        Blob: "readonly",
        File: "readonly",
        FormData: "readonly",
        Image: "readonly",
        EventSource: "readonly",
        HTMLInputElement: "readonly",
        HTMLElement: "readonly",
        HTMLVideoElement: "readonly",
        HTMLCanvasElement: "readonly",
        Event: "readonly",
        PopStateEvent: "readonly",
        // Fehlte, solange keine Ansicht auf Tasten horchte. Der Buchen-Dialog
        // tut es (Escape schließt, Tab bleibt im Dialog) — ohne den Eintrag
        // meldet no-undef jede Typangabe KeyboardEvent in einer .vue-Datei.
        KeyboardEvent: "readonly",
        AbortController: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        MediaStream: "readonly",
        // Für den Umbruchpunkt der Computer-Oberfläche (AppShell): Die
        // Medienabfrage steht in CSS UND in JavaScript, damit die untere
        // Leiste im breiten Modus gar nicht erst im DOM landet.
        MediaQueryList: "readonly",
        MediaQueryListEvent: "readonly",
        ImageData: "readonly",
        createImageBitmap: "readonly",
        OffscreenCanvas: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Einzelwort-Namen sind hier Absicht: Die Ansichten heißen wie das,
      // was sie zeigen (Kopf.vue, Symbol.vue), und die Datei ist der Name.
      "vue/multi-word-component-names": "off",
    },
  },

  // Formatierungsregeln abschalten — dafür ist Prettier zuständig, und zwei
  // Werkzeuge, die sich über Zeilenumbrüche streiten, kosten nur Zeit.
  eslintConfigPrettier,
);
