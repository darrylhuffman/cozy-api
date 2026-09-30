import { existsSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { expect, openAddPet, test } from "./fixtures.js"

type Marker = { message: string; resource: { path: string } }
type Page = { monaco: { editor: { getModelMarkers(filter: object): Marker[] } } }

const EXAMPLE = join(import.meta.dirname, "..", "..", "..", "examples", "basic-api")

test("lists providers and describes one above its code", async ({ ide }) => {
  // Explorer rows carry the provider's lifetime.
  const explorer = ide.getByRole("button", { name: "db.ts singleton" })
  await expect(explorer).toBeVisible()
  await expect(ide.getByRole("button", { name: "logger.ts scoped" })).toBeVisible()

  await explorer.click()
  const card = ide.getByRole("region", { name: "Provider db" })
  await expect(card).toContainText("The pet store's SQLite database")
  await expect(card).toContainText("PETSTORE_DB set")
  await expect(card).toContainText("6 nodes")
  await expect(card.getByRole("button", { name: "pets/add-pet" })).toBeVisible()
  await expect(ide.locator(".monaco-editor").first()).toBeVisible({ timeout: 20_000 })

  // The provider file type-checks in the editor (its own model, not a clash
  // with the workspace typings that also carry it).
  await expect
    .poll(
      async () =>
        ide.evaluate(() =>
          (globalThis as unknown as Page).monaco.editor
            .getModelMarkers({})
            .map((m) => `${m.resource.path}: ${m.message}`),
        ),
      { timeout: 20_000, intervals: [1000] },
    )
    .toEqual([])
  await ide.screenshot({ path: "test-results/provider-card.png" })

  await card.getByRole("button", { name: "pets/add-pet" }).click()
  await expect(ide.getByTestId("node-providers-bar")).toContainText("db")
})

test("shows the providers a node reads on its card", async ({ ide }) => {
  await openAddPet(ide)
  const chip = ide
    .getByTestId("node-footer")
    .filter({ hasText: "./nodes/pets/add-pet" })
    .getByRole("button", { name: "db" })
  await expect(chip).toBeVisible()
  await ide.screenshot({ path: "test-results/provider-chips.png" })
  await chip.click()
  await expect(ide.getByRole("region", { name: "Provider db" })).toBeVisible()
})

test("creates a provider from the explorer", async ({ ide }) => {
  const file = join(EXAMPLE, "providers", "e2e-cache.ts")
  const typings = join(EXAMPLE, ".lorien", "types", "providers.d.ts")
  try {
    await ide.getByText("PROVIDERS").hover()
    await ide.getByRole("button", { name: "New provider" }).click()
    await ide.getByLabel("Name").fill("e2e-cache")
    await expect(ide.getByRole("dialog")).toContainText("e2eCache")
    await ide.getByText("Scoped", { exact: true }).click()
    await ide.screenshot({ path: "test-results/new-provider.png" })
    await ide.getByRole("button", { name: "Create" }).click()

    await expect(ide.getByRole("button", { name: "e2e-cache.ts scoped" })).toBeVisible()
    const card = ide.getByRole("region", { name: "Provider e2eCache" })
    await expect(card).toContainText("No nodes yet")
    expect(existsSync(file)).toBe(true)
    // The IDE regenerated the provider typings, so nodes can read it typed.
    await expect.poll(() => readFileSync(typings, "utf-8")).toContain("e2eCache")
  } finally {
    rmSync(file, { force: true })
    // ...and drops it again once the file is gone (the typings are committed).
    await expect.poll(() => readFileSync(typings, "utf-8")).not.toContain("e2eCache")
  }
})
