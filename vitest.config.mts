import { defineConfig } from "vitest/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": resolve(rootDir, "./src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
