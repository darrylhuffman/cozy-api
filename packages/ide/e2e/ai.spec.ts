import { expect, openCreateUser, test } from "./fixtures.js"

test("Ask AI opens an agent chat with the question and the IDE context", async ({ ide }) => {
  await openCreateUser(ide)
  await ide.getByRole("button", { name: "Ask AI" }).click()
  await ide.getByLabel("Question for the AI").fill("What does this workflow do?")
  await ide.getByRole("button", { name: "Ask", exact: true }).click()
  await expect(ide.getByText("What does this workflow do?").first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(ide.getByText("Context sent from the IDE").first()).toBeVisible()
})
