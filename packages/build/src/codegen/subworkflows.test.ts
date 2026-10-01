import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { startLorienServer } from "@darrylondil/lorien-runtime"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runBuild } from "../build/run-build.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// orders/create.workflow uses nodes/orders/reserve-seats.workflow, which can answer 404 or 409.
const root = join(
  __dirname,
  "..",
  "..",
  "..",
  "runtime",
  "src",
  "dev-server",
  "__fixtures__",
  "subworkflows",
)
// Inside the fixture, so the generated code resolves hono and zod.
const distDir = join(root, "dist-test")

let built: Hono
let interpreted: Hono

beforeAll(async () => {
  const result = await runBuild({ root, outDir: distDir, skipTypes: true, bundle: false })
  expect(result.ok).toBe(true)
  const gen = await import(
    pathToFileURL(join(distDir, "workflows", "orders", "create.gen.ts")).href
  )
  built = new Hono()
  gen.register(built)
  interpreted = await startLorienServer({ root, lenient: false })
}, 30000)

afterAll(async () => {
  await rm(distDir, { recursive: true, force: true })
})

const post = (app: Hono, id: string, body: unknown) =>
  app.request(`/events/${id}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("sub-workflows: lorien build == dev server", () => {
  it.each([
    ["the happy path", "e1", { quantity: 2 }, 201],
    ["a Response inside the sub-workflow (404)", "nope", { quantity: 1 }, 404],
    ["a later Response inside it (409)", "e2", { quantity: 3 }, 409],
    ["a bad request value that reaches a node inside it", "e1", { quantity: "two" }, 400],
  ])("answers %s the same way", async (_label, id, body, status) => {
    const fromBuild = await post(built, id, body)
    const fromDev = await post(interpreted, id, body)
    expect(fromBuild.status).toBe(status)
    expect(fromDev.status).toBe(status)
    expect(await fromBuild.json()).toEqual(await fromDev.json())
  })
})
