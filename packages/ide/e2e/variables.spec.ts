import type { Page } from "@playwright/test"
import { expect, openAddPet, test } from "./fixtures.js"

/** Drags an input's handle out onto empty canvas below the nodes. */
async function pullOut(page: Page, nodeId: string, portId: string) {
  const handle = page.locator(
    `.react-flow__handle[data-nodeid="${nodeId}"][data-handleid="${portId}"]`,
  )
  const from = await handle.boundingBox()
  const pane = await page.locator(".react-flow__pane").boundingBox()
  if (!from || !pane) throw new Error("canvas not ready")
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  const to = { x: from.x - 40, y: pane.y + pane.height - 140 }
  await page.mouse.move(from.x - 20, from.y + 40, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 8 })
  return to
}

test("dragging an input's handle onto empty canvas makes a typed variable", async ({ ide }) => {
  await openAddPet(ide)

  // While dragging, a preview says what letting go will make.
  const to = await pullOut(ide, "Response", "status")
  await expect(ide.getByTestId("variable-ghost")).toContainText("status")
  await expect(ide.getByTestId("variable-ghost")).toContainText("Number")
  await ide.mouse.up()

  // It keeps the input's value, and the input now reads it.
  const variable = ide.getByTestId("variable-node")
  await expect(variable).toContainText("VAR")
  await expect(variable).toContainText("status")
  await expect(variable).toContainText("number")
  await expect(variable.getByLabel("status")).toHaveValue("201")
  await expect(variable).toContainText("Feeds Response.status")
  await expect(ide.getByTitle("From status.value")).toBeVisible()
  // Its output handle landed where the drag ended.
  const out = await ide
    .locator('.react-flow__handle[data-nodeid="status"][data-handleid="value"]')
    .boundingBox()
  expect(Math.abs((out?.x ?? 0) - to.x)).toBeLessThan(20)

  await variable.getByLabel("status").fill("202")
  await expect(ide.getByText(/Unsaved changes/)).toBeVisible()

  // An enum input becomes a select with the schema's options.
  await pullOut(ide, "Request", "method")
  await ide.mouse.up()
  const method = ide.getByTestId("variable-node").filter({ hasText: "method" })
  await expect(method.getByLabel("method")).toHaveValue(/\d/)
  await expect(method.getByLabel("method").locator("option:checked")).toHaveText("POST")
  await method.getByLabel("method").selectOption("PUT")
  await expect(method.getByLabel("method").locator("option:checked")).toHaveText("PUT")

  // Undo takes the variables back out, and the inputs get their values back.
  await ide.getByRole("button", { name: "Undo" }).click()
  await ide.getByRole("button", { name: "Undo" }).click()
  await ide.getByRole("button", { name: "Undo" }).click()
  await ide.getByRole("button", { name: "Undo" }).click()
  await expect(ide.getByTestId("variable-node")).toHaveCount(0)
  await expect(ide.getByTestId("input-chip-status")).toHaveText("201")
})
