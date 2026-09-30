import { test as base, expect, type Page } from "@playwright/test"

/** A page on a fresh IDE (no saved layout), failing the test on uncaught page errors. */
export const test = base.extend<{ ide: Page }>({
  ide: async ({ page }, use) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    await page.goto("/")
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.getByText("WORKFLOWS", { exact: true })).toBeVisible()
    await use(page)
    expect(errors, "uncaught errors in the page").toEqual([])
  },
})

export { expect }

/** Opens workflows/pets/add.workflow (POST /pets) from the file tree. */
export async function openAddPet(page: Page) {
  await page.getByRole("button", { name: "add.workflow" }).click()
  await expect(page.locator('[data-testid="node-header"]').first()).toBeVisible()
}
