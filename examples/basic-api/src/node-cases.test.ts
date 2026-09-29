import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runNodeCases } from "@darrylondil/lorien-runtime/testing"
import { expect, test } from "vitest"

// Runs nodes/**/*.cases.json — the cases the IDE's Tests tab edits.
const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const files = await runNodeCases({ root })

for (const file of files) {
  if (file.error) test(file.path, () => expect.fail(file.error))
  for (const r of file.results) {
    test(`${file.path} › ${r.name}`, () => {
      expect(r.failures).toEqual([])
    })
  }
}
