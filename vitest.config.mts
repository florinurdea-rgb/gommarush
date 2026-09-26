import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(rootDir, "./src"),
      // The real `server-only` throws on import outside an RSC, which would
      // make every server module untestable. Stubbed so the tests can reach
      // them; the guard still applies to the real build.
      "server-only": resolve(rootDir, "./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
