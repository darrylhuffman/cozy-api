import { test as base, expect, type Page } from "@playwright/test"

/** A page on a fresh IDE (no saved layout), failing the test on uncaught page errors. */
export const test = base.extend<{ ide: Page }>({
  ide: async ({ page }, use) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.goto("/")
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.getByText("WORKFLOWS")).toBeVisible()
    await use(page)
    expect(errors, "uncaught errors in the page").toEqual([])
  },
})

export { expect }

/** Opens workflows/user/create.workflow from the file tree. */
export async function openCreateUser(page: Page) {
  // The tree lists cart/create.workflow first, then user/create.workflow.
  await page.getByRole("button", { name: "create.workflow" }).nth(1).click()
  await expect(page.locator('[data-testid="node-header"]').first()).toBeVisible()
}
