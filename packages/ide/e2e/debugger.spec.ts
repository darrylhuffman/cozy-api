import { expect, openCreateUser, test } from "./fixtures.js"

test("a breakpoint set from the canvas pauses the next request", async ({ ide }) => {
  await openCreateUser(ide)
  await expect(ide.getByText("Debugger connected")).toBeVisible()
  await ide.locator('[data-testid="node-header"]').nth(1).click({ button: "right" })
  await ide.getByText("Toggle breakpoint (before)").click()
  await expect(ide.locator('[data-testid="node-breakpoint-dot-before"]')).toHaveCount(1)

  const response = ide.request.post("/users", {
    data: { email: "bp@example.com", password: "correct-horse" },
  })
  const banner = ide.getByTestId("status-banner")
  await expect(banner).toContainText("Paused at SaveUser.before")
  await banner.getByRole("button", { name: "Continue" }).click()
  expect((await response).status()).toBe(200)
  await expect(banner).toContainText("Completed")
})
