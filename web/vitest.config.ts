import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

/**
 * Tests der Oberfläche.
 *
 * Bewusst getrennt von der Server-Testsuite im Wurzelverzeichnis: Die läuft
 * gegen eine echte Datenbank, diese hier gegen gar nichts. Zwei Umgebungen,
 * zwei Konfigurationen — sonst müsste jeder Frontend-Test eine Datenbank
 * hochfahren, und niemand würde sie mehr ausführen.
 *
 *   npm run test:web        (aus dem Wurzelverzeichnis)
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globals: true,
    // jsdom, weil Komponenten ein DOM brauchen. Die reinen Store-Tests
    // kämen ohne aus, aber zwei Umgebungen in einer Suite lohnen nicht.
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
