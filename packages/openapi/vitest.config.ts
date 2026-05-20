import { resolve } from "node:path"
import { defineConfig } from "vitest/config"

// Resolve zod and @cozy/runtime explicitly so that dynamically-imported
// generated TypeScript files (written to a temp dir during acceptance tests)
// can resolve their imports through the workspace graph.
const zodDir = resolve(import.meta.dirname, "node_modules/@cozy/runtime/node_modules/zod")
const runtimeDir = resolve(import.meta.dirname, "node_modules/@cozy/runtime")

export default defineConfig({
  resolve: {
    alias: {
      zod: zodDir,
      "@cozy/runtime": runtimeDir,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
})
