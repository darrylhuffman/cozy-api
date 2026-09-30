import { expect, openAddPet, test } from "./fixtures.js"

test("runs the workflow's saved requests from the Run tab", async ({ ide }) => {
  await openAddPet(ide)
  await ide.getByRole("tab", { name: "Run" }).click()
  await ide.getByRole("button", { name: "Run all" }).click()
  await expect(ide.getByText("3/3 passed")).toBeVisible({ timeout: 20_000 })
  // The Debug panel follows the requests just sent: the newest run is selected.
  const rows = ide.getByTestId("runs-row")
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toHaveAttribute("aria-current", "true")

  // Playing one saved request opens it in the builder below.
  await ide.getByTestId("saved-requests").getByText("Adds a pet").hover()
  await ide.getByRole("button", { name: "Run Adds a pet" }).click()
  await expect(ide.getByLabel("Request name")).toHaveValue("Adds a pet")
})

test("runs a node's test cases from the Tests tab and badges the node", async ({ ide }) => {
  await openAddPet(ide)
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
  // The Explorer shows the pass count next to the node file too.
  await expect(ide.getByRole("img", { name: "4 of 4 tests passing" })).toBeVisible()
})

test("runs workflow tests, mocks included, from the Tests tab", async ({ ide }) => {
  await openAddPet(ide)
  await ide.getByRole("tab", { name: "Tests" }).click()
  const flows = ide.getByTestId("workflow-tests")
  await expect(flows.getByTestId("workflow-test")).toHaveCount(3)
  await expect(flows.getByText("1 mocked · 1 step check")).toBeVisible()
  await ide.getByRole("button", { name: "Run all workflow tests" }).click()
  await expect(flows.getByText("3/3 passed")).toBeVisible({ timeout: 20_000 })

  // A test opens in the Run tab with its mock.
  await flows.getByText("Reports a database failure as a 500").click()
  await expect(ide.getByRole("tab", { name: /Mocks\s*1/ })).toBeVisible()
  await ide.getByRole("tab", { name: /Mocks/ }).click()
  await expect(ide.getByLabel("Error message")).toHaveValue("database is locked")
})

test("picks a check's field from the response shape instead of typing a path", async ({ ide }) => {
  await openAddPet(ide)
  await ide.getByRole("tab", { name: "Run" }).click()
  await ide.getByTestId("saved-requests").getByText("Adds a pet").click()
  await expect(ide.getByLabel("Request name")).toHaveValue("Adds a pet")
  const rows = ide.getByTestId("assertion-row")
  await expect(rows).toHaveCount(5)

  await ide.getByRole("button", { name: "+ Add check" }).click()
  const row = rows.nth(5)
  await row.getByRole("button", { name: "Pick a field" }).click()
  // The body's fields come from AddPet's output schema, typed.
  const picker = ide.getByTestId("check-picker")
  await expect(picker.getByRole("button", { name: /^species\s*string$/ })).toBeVisible()
  await picker.getByRole("button", { name: /^species/ }).click()
  await expect(row.getByTestId("check-subject")).toContainText("species")
  await row.getByLabel("Expected value").fill("dog")

  await ide.getByRole("button", { name: "Send" }).click()
  const results = ide.getByRole("list", { name: "Check results" })
  await expect(results).toContainText('body.species equals "dog"', { timeout: 20_000 })
  await expect(ide.getByTestId("request-result")).toContainText("Passed")
})
