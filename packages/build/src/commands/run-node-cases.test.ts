import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { createIdeApp } from "./ide.js"
import { parseWorkerOutput, runNodeCasesInWorker } from "./run-node-cases.js"

const example = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples/basic-api")
// The worker inherits this, so the example opens a throwaway pet store database.
process.env.PETSTORE_DB = ":memory:"

describe("parseWorkerOutput", () => {
  it("splits node logs from the result line", () => {
    const out = parseWorkerOutput(
      '[info] hi\n\n__LORIEN_NODE_CASES__[{"path":"a","uses":"./a","results":[]}]\n',
    )
    expect(out).toEqual({ logs: "[info] hi", files: [{ path: "a", uses: "./a", results: [] }] })
  })

  it("returns null files when the worker never reported", () => {
    expect(parseWorkerOutput("crashed").files).toBeNull()
  })
})

describe("runNodeCasesInWorker", () => {
  it("runs the example's node cases in a fresh subprocess", async () => {
    const run = await runNodeCasesInWorker(example, {})
    expect(run.error).toBeUndefined()
    const file = run.files.find((f) => f.path === "nodes/pets/add-pet.cases.json")
    expect(file?.results.map((r) => [r.caseId, r.passed])).toEqual([
      ["addsAPet", true],
      ["returnsTheStoredRecord", true],
      ["rejectsAMissingName", true],
      ["surfacesDatabaseErrors", true],
    ])
  }, 30_000)

  it("runs only the requested cases", async () => {
    const run = await runNodeCasesInWorker(example, {
      only: { "nodes/pets/add-pet.cases.json": ["rejectsAMissingName"] },
    })
    expect(run.files[0]?.results.map((r) => r.caseId)).toEqual(["rejectsAMissingName"])
  }, 30_000)
})

describe("POST /api/tests/nodes", () => {
  it("passes filter and only through and returns the run", async () => {
    const calls: unknown[] = []
    const app = createIdeApp("/ws", {
      runNodeCases: async (root, req) => {
        calls.push([root, req])
        return { files: [], logs: "hello" }
      },
    })
    const res = await app.request("/api/tests/nodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter: "save-user", only: { a: ["x"] }, junk: 1 }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ files: [], logs: "hello" })
    expect(calls).toEqual([["/ws", { filter: "save-user", only: { a: ["x"] } }]])
  })

  it("returns 500 with the reason when the worker fails", async () => {
    const app = createIdeApp("/ws", {
      runNodeCases: async () => ({ files: [], logs: "", error: "boom" }),
    })
    const res = await app.request("/api/tests/nodes", { method: "POST", body: "{}" })
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toBe("boom")
  })
})
