import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Component tests (tests/**/*.test.tsx) render real React; Next's tsconfig
  // keeps JSX as "preserve", so vitest needs the automatic runtime itself.
  oxc: { jsx: { runtime: "automatic" } },
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
    // .tsx files opt into jsdom per file with `// @vitest-environment jsdom`.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
