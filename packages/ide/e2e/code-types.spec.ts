import { expect, test } from "./fixtures.js"

type Marker = { code?: string | { value: string }; message: string }
type Rect = { left: number; top: number }
/** The slice of the DOM this spec touches (the e2e tsconfig has no DOM lib). */
type Page = {
  monaco: { editor: { getModelMarkers(filter: object): Marker[] } }
  document: {
    querySelectorAll(sel: string): Iterable<Box>
    elementFromPoint(x: number, y: number): unknown
  }
}
type Box = {
  textContent: string | null
  getBoundingClientRect(): Rect
  contains(n: unknown): boolean
}

test("resolves package imports in node code and shows error hovers unclipped", async ({ ide }) => {
  await ide.getByRole("button", { name: "save-user.ts" }).click()
  await expect(ide.locator(".monaco-editor").first()).toBeVisible({ timeout: 20_000 })

  const markers = async () =>
    ide.evaluate(() =>
      (globalThis as unknown as Page).monaco.editor.getModelMarkers({}).map((m) => ({
        message: m.message,
        code: typeof m.code === "object" ? m.code.value : String(m.code),
      })),
    )

  // Let the TypeScript worker settle with the workspace typings loaded.
  await expect
    .poll(async () => (await markers()).length, { timeout: 20_000, intervals: [1000] })
    .toBe(0)

  const editor = ide.locator(".monaco-editor").first()
  // A type error on line 3: its hover opens upward, past the editor's top
  // edge and over the tab strip.
  await editor.locator(".view-line").nth(2).click()
  await ide.keyboard.type("export const n: number = z.string()")
  await expect
    .poll(async () => (await markers()).map((m) => m.message).join("\n"), { timeout: 20_000 })
    .toContain("'ZodString' is not assignable to type 'number'")
  const all = await markers()
  // Package imports resolve: no "Cannot find module" (2307 / 2792).
  expect(all.map((m) => m.code)).not.toContain("2792")
  expect(all.map((m) => m.code)).not.toContain("2307")

  // Hover the error near the top of the editor: the hover must not be clipped.
  const squiggle = await editor.locator(".squiggly-error").first().boundingBox()
  if (!squiggle) throw new Error("no error squiggle")
  await ide.mouse.move(squiggle.x + squiggle.width / 2, squiggle.y + squiggle.height / 2)
  const hover = ide.locator(".monaco-hover").filter({ hasText: "not assignable" }).first()
  await expect(hover).toBeVisible()
  await ide.screenshot({ path: "test-results/code-types-hover.png" })
  // Fully inside the viewport, and not cut at the editor's top edge.
  const top = await ide.evaluate(() => {
    const { document } = globalThis as unknown as Page
    const el = [...document.querySelectorAll(".monaco-hover")].find((e) =>
      e.textContent?.includes("not assignable"),
    )
    if (!el) return { top: -1, visible: false }
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + 8, r.top + 8)
    return { top: r.top, visible: !!hit && el.contains(hit) }
  })
  expect(top.top).toBeGreaterThanOrEqual(0)
  expect(top.visible).toBe(true)
})
