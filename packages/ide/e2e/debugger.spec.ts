import { expect, openAddPet, test } from "./fixtures.js"

test("a breakpoint set from the canvas pauses the next request", async ({ ide }) => {
  await openAddPet(ide)
  await expect(ide.getByText("Debugger connected")).toBeVisible()
  await ide.locator('[data-testid="node-header"]').nth(1).click({ button: "right" })
  await ide.getByText("Toggle breakpoint (before)").click()
  await expect(ide.locator('[data-testid="node-breakpoint-dot-before"]')).toHaveCount(1)

  const response = ide.request.post("/pets", { data: { name: "bp-pet", species: "dog" } })
  const banner = ide.getByTestId("status-banner")
  await expect(banner).toContainText("Paused at AddPet.before")
  await banner.getByRole("button", { name: "Continue" }).click()
  expect((await response).status()).toBe(201)
  await expect(banner).toContainText("Completed")
})
