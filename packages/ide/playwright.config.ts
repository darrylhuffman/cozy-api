import { defineConfig, devices } from "@playwright/test"

const PORT = 8199

/**
 * Browser tests against the real IDE server (`lorien ide`) on the
 * examples/basic-api project. Needs the packages built first
 * (`pnpm -r --filter "./packages/**" build`).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1500, height: 950 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1500, height: 950 } },
    },
  ],
  webServer: {
    command: `node ../build/dist/cli.js ide --root ../../examples/basic-api --no-open --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    // A fresh, seeded pet store per run instead of the example's data/petstore.db.
    env: { PETSTORE_DB: ":memory:" },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
