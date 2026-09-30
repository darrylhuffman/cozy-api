import { expect, openAddPet, test } from "./fixtures.js"

test("Ask AI opens an agent chat with the question and the IDE context", async ({ ide }) => {
  await openAddPet(ide)
  await ide.getByRole("button", { name: "Ask AI" }).click()
  await ide.getByLabel("Question for the AI").fill("What does this workflow do?")
  await ide.getByRole("button", { name: "Ask", exact: true }).click()
  await expect(ide.getByText("What does this workflow do?").first()).toBeVisible({
    timeout: 15_000,
  })
  await expect(ide.getByText("Context sent from the IDE").first()).toBeVisible()
})

test("Agents is its own panel beside the Inspector", async ({ ide }) => {
  await openAddPet(ide)
  const toggle = ide.getByRole("button", { name: "Agents", exact: true })
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  // Both are visible at once: the Inspector keeps its tabs, Agents shows next to it.
  await expect(ide.getByRole("tab", { name: "Run" })).toBeVisible()
  await expect(ide.locator(".dv-tab", { hasText: "Agents" })).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-pressed", "false")
  await expect(ide.locator(".dv-tab", { hasText: "Agents" })).toHaveCount(0)
})
