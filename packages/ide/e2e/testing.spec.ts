import { expect, openCreateUser, test } from "./fixtures.js"

test("runs the workflow's saved requests from the Run tab", async ({ ide }) => {
  await openCreateUser(ide)
  await ide.getByRole("tab", { name: "Run" }).click()
  await ide.getByRole("button", { name: "Run all" }).click()
  await expect(ide.getByText("2/2 passed")).toBeVisible({ timeout: 20_000 })
})

test("runs a node's test cases from the Tests tab and badges the node", async ({ ide }) => {
  await openCreateUser(ide)
  await ide.getByRole("tab", { name: "Tests" }).click()
  await ide
    .getByRole("button", { name: /^Run .* cases$/ })
    .first()
    .click()
  await expect(ide.getByText(/^4\/4 passed$/).first()).toBeVisible({ timeout: 30_000 })
  await expect(ide.locator('[data-testid="node-tests-badge"]').first()).toHaveAttribute(
    "aria-label",
    /4 of 4 passing/,
  )
})
