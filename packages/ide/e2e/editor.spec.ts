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

test("edits input values on the node card, one undo step per edit", async ({ ide }) => {
  await openCreateUser(ide)
  const pathChip = ide.getByRole("button", { name: "Edit path" })
  await pathChip.click()
  await ide.keyboard.type("/people")
  await ide.keyboard.press("Enter")
  await expect(ide.getByTestId("input-chip-path")).toHaveText("/people")

  await ide.getByRole("button", { name: "Choose method" }).click()
  await ide.getByRole("option", { name: "PUT" }).click()
  await expect(ide.getByTestId("input-chip-method")).toContainText("PUT")

  await ide.getByRole("button", { name: "Undo" }).click()
  await expect(ide.getByTestId("input-chip-method")).toContainText("POST")
  await expect(ide.getByTestId("input-chip-path")).toHaveText("/people")
})

test("the Delete key removes the selected node, and undo brings it back", async ({ ide }) => {
  await openCreateUser(ide)
  const nodes = ide.locator('[data-testid="node-header"]')
  const before = await nodes.count()
  await nodes.first().click()
  await ide.keyboard.press("Delete")
  await expect(nodes).toHaveCount(before - 1)
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

test("overflowing workflow tabs scroll with arrows instead of a scrollbar", async ({ ide }) => {
  await ide.setViewportSize({ width: 1000, height: 800 })
  await ide.getByRole("button", { name: "item", exact: true }).click()
  await expect(ide.getByRole("button", { name: "add.workflow" })).toBeVisible()
  const tree = ide.getByRole("button", { name: /\.workflow$/ })
  const count = await tree.count()
  for (let i = 0; i < count; i++) await tree.nth(i).click()

  const right = ide.getByRole("button", { name: "Scroll tabs right" })
  const left = ide.getByRole("button", { name: "Scroll tabs left" })
  // The last opened tab is active and scrolled into view, so there is more to the left.
  await expect(left).toBeVisible()
  const strip = ide.getByTestId("editor-tab-strip").first()
  expect(await strip.evaluate((el) => el.offsetHeight - el.clientHeight)).toBe(0)

  const before = await strip.evaluate((el) => el.scrollLeft)
  await left.click()
  await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeLessThan(before)
  // Keep going until the start: the left arrow goes away.
  for (let i = 0; i < 10 && (await left.isVisible()); i++) {
    await left.click()
    await ide.waitForTimeout(300)
  }
  await expect(left).toBeHidden()
  expect(await strip.evaluate((el) => el.scrollLeft)).toBe(0)
  await expect(right).toBeVisible()
})

test("tabs reorder by drag and close from a right-click menu", async ({ ide }) => {
  await ide.getByRole("button", { name: "get.workflow" }).click()
  await ide.getByRole("button", { name: "save-user.ts" }).click()
  await ide.getByRole("button", { name: "test.ts" }).click()
  const strip = ide.getByTestId("editor-tab-strip")
  const order = () =>
    strip.locator("[data-tab-id]").evaluateAll((els) => els.map((e) => e.textContent?.trim()))
  await expect.poll(order).toEqual(["get.workflow", "save-user.ts", "test.ts"])

  // Drag test.ts in front of get.workflow.
  const first = strip.locator("[data-tab-id]").first()
  await strip.getByRole("button", { name: "test.ts", exact: true }).dragTo(first, {
    targetPosition: { x: 4, y: 10 },
  })
  await expect.poll(order).toEqual(["test.ts", "get.workflow", "save-user.ts"])

  await strip.getByRole("button", { name: "get.workflow", exact: true }).click({ button: "right" })
  await ide.getByRole("menuitem", { name: "Close others" }).click()
  await expect.poll(order).toEqual(["get.workflow"])
})
