import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    // Die gebaute Oberfläche liefert der Hono-Server aus — eine Anwendung,
    // ein Prozess, ein Port. Kein zweiter Webserver im Betrieb.
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    // In der Entwicklung läuft die API getrennt auf 3000. Der Umweg über den
    // Proxy sorgt dafür, dass das Sitzungs-Cookie als gleiche Herkunft gilt —
    // sonst blockiert SameSite=Strict jede Anfrage.
    proxy: { "/api": { target: "http://127.0.0.1:3000", changeOrigin: false } },
  },
});
