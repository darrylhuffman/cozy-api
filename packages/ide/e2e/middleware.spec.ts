import { readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { expect, openAddPet, test } from "./fixtures.js"

const EXAMPLE = join(import.meta.dirname, "..", "..", "..", "examples", "basic-api")

test("shows the middleware guarding a route and opens it", async ({ ide }) => {
  await expect(
    ide.getByTestId("files-panel").getByRole("button", { name: "_middleware.ts" }),
  ).toBeVisible()
  await openAddPet(ide)
  const guarded = ide.getByTestId("guarded-by")
  await expect(guarded).toContainText("Request log")
  await ide.screenshot({ path: "test-results/guarded-by.png" })

  await guarded.getByRole("button", { name: "Request log" }).click()
  const bar = ide.getByTestId("middleware-bar")
  await expect(bar).toContainText("Runs before every route in workflows/")
  await expect(bar.getByRole("button", { name: "logger" })).toBeVisible()
  await ide.screenshot({ path: "test-results/middleware-file.png" })
})

test("the dev server runs middleware, and a new one applies without a restart", async ({ ide }) => {
  const res = await ide.request.get("/pets")
  expect(res.headers()["x-response-time"]).toMatch(/^\d+ms$/)

  const file = join(EXAMPLE, "workflows", "store", "_middleware.ts")
  try {
    await ide.getByRole("button", { name: "store", exact: true }).first().click({ button: "right" })
    await ide.getByText("New middleware…").click()
    await expect(ide.getByRole("dialog")).toContainText("workflows/store/_middleware.ts")
    await ide.getByRole("button", { name: "Create" }).click()
    await expect(ide.getByTestId("middleware-bar")).toContainText("after workflows/_middleware.ts")
    expect(readFileSync(file, "utf-8")).toContain("defineMiddleware")

    // The IDE reloads routes when a _middleware.ts changes.
    await ide.request.put("/api/workspace/file", {
      data: {
        path: "workflows/store/_middleware.ts",
        content: `import { defineMiddleware } from "@darrylondil/lorien-runtime"
export default defineMiddleware({
  name: "Store closed",
  run: (c) => c.json({ error: "closed" }, 503),
})
`,
      },
    })
    await expect
      .poll(async () => (await ide.request.get("/store/inventory")).status(), { timeout: 10_000 })
      .toBe(503)
    expect((await ide.request.get("/pets")).status()).toBe(200)
  } finally {
    rmSync(file, { force: true })
    await expect
      .poll(async () => (await ide.request.get("/store/inventory")).status(), { timeout: 10_000 })
      .toBe(200)
  }
})
