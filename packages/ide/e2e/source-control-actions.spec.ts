import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures.js"
import { type Sandbox, startSandbox } from "./git-sandbox.js"

// Everyday Source Control actions, in a throwaway repository with its own IDE server.
let sb: Sandbox
test.beforeAll(async () => {
  sb = await startSandbox(8196)
})
test.afterAll(async () => {
  await sb?.stop()
})

const pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors.length = 0
  page.on("pageerror", (e) => pageErrors.push(e.message))
})
test.afterEach(() => {
  expect(pageErrors, "uncaught errors in the page").toEqual([])
  // Leave a clean tree for the next test.
  sb.git("reset", "-q", "--hard")
  sb.git("clean", "-qfd")
  sb.git("stash", "clear")
})

const NODE = "nodes/pets/list-pets.ts"
const nodeFile = () => join(sb.workspace, NODE)

async function openPanel(page: Page) {
  await page.goto(sb.url)
  await expect(page.getByText("WORKFLOWS", { exact: true })).toBeVisible()
  await page.getByTestId("status-git").click()
  return page.getByTestId("source-control")
}

test("discards a file's changes and deletes a new file, after asking", async ({ page }) => {
  const original = readFileSync(nodeFile(), "utf-8")
  writeFileSync(nodeFile(), `${original}// scratch\n`)
  writeFileSync(join(sb.workspace, "nodes", "scratch.ts"), "export {}\n")
  const panel = await openPanel(page)
  const changes = panel.getByRole("region", { name: "Changes" })
  await expect(changes).toContainText("list-pets.ts")
  await expect(changes).toContainText("scratch.ts")

  // Cancelling leaves the file alone.
  await changes.getByRole("button", { name: "Discard changes list-pets.ts" }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog).toContainText("Discard changes to list-pets.ts?")
  await dialog.getByRole("button", { name: "Cancel" }).click()
  expect(readFileSync(nodeFile(), "utf-8")).toContain("// scratch")

  await changes.getByRole("button", { name: "Discard changes list-pets.ts" }).click()
  await dialog.getByRole("button", { name: "Discard" }).click()
  await expect(changes).not.toContainText("list-pets.ts")
  expect(readFileSync(nodeFile(), "utf-8")).toBe(original)

  // A new file is deleted, from the right-click menu.
  await changes.getByRole("button", { name: /^scratch\.ts/ }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Delete file…" }).click()
  await expect(dialog).toContainText("Delete scratch.ts?")
  await dialog.getByRole("button", { name: "Delete file" }).click()
  await expect(changes).toContainText("No changes since the last commit.")
})

test("stages and unstages single changes, and marks them in the editor gutter", async ({
  page,
}) => {
  const original = readFileSync(nodeFile(), "utf-8")
  writeFileSync(nodeFile(), `// first\n${original}// last\n`)
  const panel = await openPanel(page)
  const changes = panel.getByRole("region", { name: "Changes" })
  await changes.getByRole("button", { name: /^list-pets\.ts/ }).click()

  const view = page.getByTestId("diff-view")
  const bar = view.getByTestId("hunk-bar")
  await expect(bar.getByTestId("hunk-position")).toHaveText("Change 1 of 2")
  await bar.getByRole("button", { name: "Stage change" }).click()

  // Only the first change is staged; the file is in both lists.
  const staged = panel.getByRole("region", { name: "Staged" })
  await expect(staged).toContainText("list-pets.ts")
  await expect(changes).toContainText("list-pets.ts")
  expect(sb.git("diff", "--cached", "--", `apps/api/${NODE}`)).toContain("+// first")
  expect(sb.git("diff", "--cached", "--", `apps/api/${NODE}`)).not.toContain("+// last")
  await expect(bar.getByTestId("hunk-position")).toHaveText("Change 1 of 1")

  // Unstage it again from the staged side.
  await staged.getByRole("button", { name: /^list-pets\.ts/ }).click()
  const stagedView = page.getByTestId("diff-view")
  await expect(stagedView).toContainText("HEAD ↔ staged")
  await stagedView.getByRole("button", { name: "Unstage change" }).click()
  await expect(panel.getByRole("region", { name: "Staged" })).toHaveCount(0)
  expect(sb.git("diff", "--cached")).toBe("")

  // Opening the file shows the change marks next to the edited lines.
  await changes.getByRole("button", { name: "Open list-pets.ts" }).click()
  await expect(page.locator(".monaco-editor .git-gutter-added")).toHaveCount(2)

  // Discarding a single change from the diff writes the file back.
  await changes.getByRole("button", { name: /^list-pets\.ts/ }).click()
  await page.getByTestId("hunk-bar").getByRole("button", { name: "Discard change" }).click()
  await expect(page.getByTestId("hunk-position")).toHaveText("Change 1 of 1")
  expect(readFileSync(nodeFile(), "utf-8")).toBe(`${original}// last\n`)
})

test("commits everything, syncs, amends, undoes and stashes", async ({ page }) => {
  const original = readFileSync(nodeFile(), "utf-8")
  writeFileSync(nodeFile(), `${original}// one\n`)
  const panel = await openPanel(page)
  const changes = panel.getByRole("region", { name: "Changes" })
  await expect(changes).toContainText("list-pets.ts")

  // With nothing staged, the button commits every change.
  await panel.getByLabel("Commit message").fill("Note one")
  await panel.getByRole("button", { name: "Commit all 1 change" }).click()
  const history = panel.getByRole("region", { name: "History" })
  await expect(history).toContainText("Note one")

  // Now ahead of origin: the button syncs.
  await panel.getByRole("button", { name: "Sync changes ↑1" }).click()
  await expect(panel.getByRole("button", { name: "Nothing to commit" })).toBeVisible()
  expect(sb.git("rev-parse", "origin/main")).toBe(sb.git("rev-parse", "HEAD"))

  // Amend a local commit with a new message.
  writeFileSync(nodeFile(), `${original}// one\n// two\n`)
  await panel.getByLabel("Commit message").fill("Note two")
  await panel.getByRole("button", { name: "Commit all 1 change" }).click()
  await expect(history).toContainText("Note two")
  await panel.getByLabel("Commit message").fill("Note two, reworded")
  await panel.getByRole("button", { name: "Commit options" }).click()
  await page.getByRole("menuitem", { name: "Amend last commit", exact: true }).click()
  await expect(history).toContainText("Note two, reworded")
  expect(sb.git("log", "--format=%s", "-3").trim().split("\n")).toEqual([
    "Note two, reworded",
    "Note one",
    "Initial",
  ])

  // Undo it: the change comes back staged.
  await panel.getByRole("button", { name: "More actions" }).click()
  await page.getByRole("menuitem", { name: "Undo last commit" }).click()
  await expect(history).not.toContainText("Note two")
  await expect(panel.getByRole("region", { name: "Staged" })).toContainText("list-pets.ts")

  // Stash it, then pop it back.
  await panel.getByRole("button", { name: "More actions" }).click()
  await page.getByRole("menuitem", { name: "Stash changes", exact: true }).click()
  const stashes = panel.getByRole("region", { name: "Stashes" })
  await expect(stashes).toContainText("Note one")
  await expect(changes).toContainText("No changes since the last commit.")
  expect(readFileSync(nodeFile(), "utf-8")).not.toContain("// two")
  await stashes.getByRole("listitem").hover()
  await stashes.getByRole("button", { name: /^Pop stash/ }).click()
  await expect(panel.getByRole("region", { name: "Stashes" })).toHaveCount(0)
  expect(readFileSync(nodeFile(), "utf-8")).toContain("// two")
})
