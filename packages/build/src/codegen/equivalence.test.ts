import { readFile, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseWorkflowFromString } from "@darrylondil/lorien-runtime"
import { testWorkflow } from "@darrylondil/lorien-runtime/testing"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { runBuild } from "../build/run-build.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const basicApiRoot = join(__dirname, "..", "..", "..", "..", "examples", "basic-api")
const distDir = join(basicApiRoot, "dist-test")
// Both sides open the example's pet store; keep it in memory, not data/petstore.db.
process.env.PETSTORE_DB = ":memory:"

beforeAll(async () => {
  await runBuild({ root: basicApiRoot, outDir: distDir, skipTypes: true })
}, 30000)

afterAll(async () => {
  await rm(distDir, { recursive: true, force: true })
})

describe("equivalence: interpreter == codegen", () => {
  it("GET /pets/:id produces identical responses", async () => {
    // --- Load the workflow file & node (shared between both sides) ---
    const wfPath = join(basicApiRoot, "workflows", "pets", "get.workflow")
    const workflow = parseWorkflowFromString(await readFile(wfPath, "utf-8"))
    const findPet = (
      await import(pathToFileURL(join(basicApiRoot, "nodes", "pets", "find-pet.ts")).href)
    ).default

    // The generated .gen.ts uses the example's lorien.config services directly,
    // so the interpreter gets the same ones: both read the seeded pet store.
    const configMod = await import(pathToFileURL(join(basicApiRoot, "lorien.config.ts")).href)
    const services = (configMod.default as { services: Record<string, unknown> }).services

    for (const id of ["1", "99999"]) {
      // --- Interpreter side ---
      const interpreterRes = await testWorkflow(workflow, {
        request: { params: { id } },
        nodes: { "./nodes/pets/find-pet": findPet },
        services: { ...services, logger: { info: () => {} } },
      })

      // --- Codegen side ---
      const genPath = join(distDir, "workflows", "pets", "get.gen.ts")
      const genMod = await import(pathToFileURL(genPath).href)
      const app = new Hono()
      genMod.register(app)
      const codegenRes = await app.request(`/pets/${id}`)

      // --- Assertions ---
      expect(codegenRes.status).toBe(interpreterRes.status)
      expect(await codegenRes.json()).toEqual(interpreterRes.body)
      // (Headers diverge by design — interpreter returns a plain object, codegen
      // returns a real Response with hono-injected headers. Skip.)
    }
  })
})
