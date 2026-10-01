import { expect, openAddPet, test } from "./fixtures.js"

test("Shift+click selects several nodes; the toolbar deletes them in one undo step", async ({
  ide,
}) => {
  await openAddPet(ide)
  const nodes = ide.locator('[data-testid="node-header"]')
  const before = await nodes.count()
  await nodes.nth(0).click()
  await nodes.nth(1).click({ modifiers: ["Shift"] })

  const toolbar = ide.getByRole("toolbar", { name: "2 nodes selected" })
  await expect(toolbar).toBeVisible()
  await expect(ide.getByText("2 nodes selected", { exact: true })).toBeVisible()

  await toolbar.getByRole("button", { name: "Delete" }).click()
  await expect(nodes).toHaveCount(before - 2)
  await expect(toolbar).toBeHidden()

  await ide.getByRole("button", { name: "Undo" }).click()
  await expect(nodes).toHaveCount(before)
})

test("Ctrl+A selects every node and Esc clears the selection", async ({ ide }) => {
  await openAddPet(ide)
  const count = await ide.locator('[data-testid="node-header"]').count()
  await ide.locator(".react-flow__pane").click({ position: { x: 5, y: 5 } })
  await ide.keyboard.press("Control+a")
  const toolbar = ide.getByRole("toolbar", { name: `${count} nodes selected` })
  await expect(toolbar).toBeVisible()
  await ide.keyboard.press("Escape")
  await expect(toolbar).toBeHidden()
  await expect(ide.locator(".react-flow__node.selected")).toHaveCount(0)
})

test("Shift+drag draws a selection box", async ({ ide }) => {
  await openAddPet(ide)
  const count = await ide.locator('[data-testid="node-header"]').count()
  const pane = await ide.locator(".react-flow__pane").boundingBox()
  if (!pane) throw new Error("no canvas")
  await ide.keyboard.down("Shift")
  await ide.mouse.move(pane.x + 4, pane.y + 4)
  await ide.mouse.down()
  await ide.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2, { steps: 5 })
  await ide.mouse.move(pane.x + pane.width - 4, pane.y + pane.height - 4, { steps: 5 })
  await ide.mouse.up()
  await ide.keyboard.up("Shift")
  await expect(ide.getByRole("toolbar", { name: `${count} nodes selected` })).toBeVisible()
})

test("dragging one selected node moves the whole group", async ({ ide }) => {
  await openAddPet(ide)
  const nodes = ide.locator('[data-testid="node-header"]')
  await nodes.nth(0).click()
  await nodes.nth(1).click({ modifiers: ["Shift"] })
  const other = ide.locator(".react-flow__node.selected").nth(1)
  const start = await other.boundingBox()
  const grip = await nodes.nth(0).boundingBox()
  if (!start || !grip) throw new Error("no nodes")
  await ide.mouse.move(grip.x + 10, grip.y + grip.height / 2)
  await ide.mouse.down()
  await ide.mouse.move(grip.x + 70, grip.y + grip.height / 2 + 60, { steps: 8 })
  await ide.mouse.up()
  const end = await other.boundingBox()
  expect(end && Math.round(end.y - start.y)).toBeGreaterThan(20)
  // Both nodes are still selected after the drag.
  await expect(ide.getByRole("toolbar", { name: "2 nodes selected" })).toBeVisible()

  // One undo puts the whole group back.
  await ide.getByRole("button", { name: "Undo" }).click()
  await expect
    .poll(async () => Math.round((await other.boundingBox())?.y ?? 0))
    .toBe(Math.round(start.y))
})
