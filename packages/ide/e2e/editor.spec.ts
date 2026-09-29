import { expect, openCreateUser, test } from "./fixtures.js"

test("opens a workflow on the canvas with its toolbar", async ({ ide }) => {
  await openCreateUser(ide)
  await expect(ide.getByText("create.workflow", { exact: true }).last()).toBeVisible()
  await expect(ide.getByRole("button", { name: /^Problems:/ })).toBeVisible()
  expect(await ide.locator('[data-testid="node-header"]').count()).toBeGreaterThan(1)
})

test("keeps unsaved edits when switching tabs, and undo restores the graph", async ({ ide }) => {
  await openCreateUser(ide)
  const nodes = ide.locator('[data-testid="node-header"]')
  const before = await nodes.count()
  await nodes.first().click()
  await ide.keyboard.press("Control+d")
  await expect(nodes).toHaveCount(before + 1)
  await expect(ide.getByText(/Unsaved changes/)).toBeVisible()

  // Away to another workflow and back: the duplicate is still there.
  await ide.getByRole("button", { name: "get.workflow" }).click()
  await expect(ide.getByText(/Unsaved changes/)).toBeHidden()
  await ide.getByRole("button", { name: /^create\.workflow\s*•$/ }).click()
  await expect(nodes).toHaveCount(before + 1)

  await ide.getByRole("button", { name: "Undo" }).click()
  await expect(nodes).toHaveCount(before)
})

test("shows the keyboard shortcuts dialog", async ({ ide }) => {
  await openCreateUser(ide)
  await ide.getByRole("button", { name: "Keyboard shortcuts" }).click()
  await expect(ide.getByRole("dialog")).toContainText("Duplicate")
})

test("opens code in the bundled Monaco editor, without a CDN", async ({ ide }) => {
  const cdn: string[] = []
  ide.on("request", (r) => {
    if (/jsdelivr|unpkg|cdnjs/.test(r.url())) cdn.push(r.url())
  })
  await ide.getByRole("button", { name: "save-user.ts" }).click()
  await expect(ide.locator(".monaco-editor").first()).toBeVisible({ timeout: 20_000 })
  await expect(ide.locator(".view-lines").first()).toContainText("export")
  expect(cdn).toEqual([])
})
