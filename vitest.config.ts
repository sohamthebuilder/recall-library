import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Each PGlite instance boots a WASM Postgres; give the first boot room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
