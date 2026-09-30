import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Each test file gets a fresh, seeded in-memory pet store instead of data/petstore.db.
    env: { PETSTORE_DB: ":memory:" },
  },
})
