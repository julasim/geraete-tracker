import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    // Tests laufen gegen EINE Datenbank und legen dort Konten an.
    // Parallel liefen sie sich gegenseitig in die Quere.
    fileParallelism: false,
    setupFiles: ["tests/helpers/aufbau.ts"],
  },
});
