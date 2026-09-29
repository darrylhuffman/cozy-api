import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { failureSummary, runRequestCollections } from "@darrylondil/lorien-runtime/testing"
import { expect, test } from "vitest"
import { buildApp } from "./server.js"

// Runs the saved requests the team keeps in workflows/**/*.requests.json (the
// IDE's Run tab edits them) against the app in-process — no server needed.
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const runs = await runRequestCollections({ root, app: await buildApp() })

for (const run of runs) {
  if (run.error) test(run.path, () => expect.fail(run.error))
  for (const result of run.results) {
    test(`${run.path} › ${result.name}`, () => {
      expect(failureSummary(result)).toEqual([])
    })
  }
}
