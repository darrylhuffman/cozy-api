import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { defineMiddleware } from "../middleware/define-middleware.js"
import {
  type FetchLike,
  runSavedRequest,
  type SavedRequest,
  serverHasTestHooks,
} from "../requests/index.js"
import { parseWorkflow } from "../workflow/parse.js"
import type { LoadedWorkflow } from "./load.js"
import { mountWorkflows } from "./server.js"

// POST /pets → AddPet (writes to a "database") → 201 with the pet.
// With `guarded`, middleware answers 401 unless the request has an x-api-key.
function petApp(testHooks: boolean, guarded = false) {
  const saved: unknown[] = []
  const addPet = defineNode({
    inputs: z.object({ name: z.string(), species: z.string() }),
    outputs: z.object({ pet: z.object({ id: z.number(), name: z.string() }) }),
    async run({ name }) {
      saved.push(name)
      return { pet: { id: saved.length, name } }
    },
  })
  const wf: LoadedWorkflow = {
    absolutePath: "/fake/workflows/pets/add.workflow",
    relativePath: "pets/add.workflow",
    file: parseWorkflow({
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/pets", method: "POST" } },
        AddPet: {
          uses: "./nodes/pets/add-pet",
          in: { name: "Request.body.name", species: "Request.body.species" },
        },
        Response: { uses: "@core/response", in: { body: "AddPet.pet" }, values: { status: 201 } },
      },
    }),
  }
  const app = new Hono()
  mountWorkflows(app, [wf], {
    nodes: { "./nodes/pets/add-pet": addPet },
    services: {},
    testHooks,
    ...(guarded
      ? {
          middleware: {
            pets: [
              defineMiddleware({
                async run(c, next) {
                  if (!c.req.header("x-api-key")) return c.json({ error: "Unauthorized" }, 401)
                  await next()
                },
              }),
            ],
          },
        }
      : {}),
  })
  const fetch: FetchLike = async (input, init) => app.fetch(new Request(input, init))
  return { fetch, saved }
}

const addPet = (over: Partial<SavedRequest> = {}): SavedRequest => ({
  id: "adds",
  name: "Adds a pet",
  method: "POST",
  path: "/pets",
  body: { kind: "json", json: { name: "Rex", species: "dog" } },
  ...over,
})

const opts = (fetch: FetchLike) => ({ baseUrl: "http://lorien.test", fetch })

describe("workflow tests with test hooks", () => {
  it("checks what a node received and returned", async () => {
    const { fetch } = petApp(true)
    const r = await runSavedRequest(
      addPet({
        expect: [
          { target: "status", op: "equals", value: 201 },
          { target: "node", node: "AddPet", path: "input.species", op: "equals", value: "dog" },
          { target: "node", node: "AddPet", path: "output.pet.id", op: "type", value: "number" },
          { target: "node", node: "AddPet", op: "exists" },
        ],
      }),
      opts(fetch),
    )
    expect(r.assertions.map((a) => a.message)).toEqual([
      "status equals 201",
      'AddPet input.species equals "dog"',
      'AddPet output.pet.id is of type "number"',
      "AddPet ran",
    ])
    expect(r.passed).toBe(true)
    expect(r.trace?.nodes.AddPet?.output).toEqual({ pet: { id: 1, name: "Rex" } })
    // The test header is not shown as part of the request.
    expect(Object.keys(r.request.headers)).not.toContain("x-lorien-test")
  })

  it("mocks a node's output without running it", async () => {
    const { fetch, saved } = petApp(true)
    const r = await runSavedRequest(
      addPet({
        mocks: { AddPet: { output: { pet: { id: 42, name: "{{petName}}" } } } },
        expect: [{ target: "body", path: "id", op: "equals", value: 42 }],
      }),
      { ...opts(fetch), vars: { petName: "Mocky" } },
    )
    expect(r.passed).toBe(true)
    expect(r.response?.body).toEqual({ id: 42, name: "Mocky" })
    expect(r.trace?.nodes.AddPet?.mocked).toBe(true)
    expect(saved).toEqual([])
  })

  it("mocks a node throwing, and reports steps that never ran", async () => {
    const { fetch } = petApp(true)
    const r = await runSavedRequest(
      addPet({
        mocks: { AddPet: { error: "database is locked" } },
        expect: [
          { target: "status", op: "equals", value: 500 },
          { target: "body", path: "detail", op: "contains", value: "database is locked" },
          { target: "node", node: "AddPet", path: "error", op: "contains", value: "locked" },
          { target: "node", node: "Response", op: "notExists" },
        ],
      }),
      opts(fetch),
    )
    expect(r.assertions.filter((a) => !a.pass)).toEqual([])
    expect(r.assertions[3]?.message).toBe("Response did not run")
  })

  it("rejects a mock for a node the workflow doesn't have", async () => {
    const { fetch } = petApp(true)
    const r = await runSavedRequest(
      addPet({
        mocks: { InsertPet: { error: "database is locked" } },
        expect: [
          { target: "status", op: "equals", value: 400 },
          { target: "body", path: "error", op: "contains", value: "InsertPet" },
        ],
      }),
      opts(fetch),
    )
    expect(r.assertions.filter((a) => !a.pass)).toEqual([])
  })

  it("says why a ran check failed", async () => {
    const { fetch } = petApp(true)
    const r = await runSavedRequest(
      addPet({
        body: { kind: "json", json: { name: "Nameless" } },
        expect: [{ target: "node", node: "AddPet", op: "exists" }],
      }),
      opts(fetch),
    )
    // Input validation stops AddPet before it runs.
    expect(r.assertions[0]?.message).toBe("expected AddPet ran, but it never ran")
  })
})

describe("saved requests and the dev server", () => {
  it("records an empty trace when middleware answers first, so 'did not run' passes", async () => {
    const { fetch, saved } = petApp(true, true)
    const r = await runSavedRequest(
      addPet({
        expect: [
          { target: "status", op: "equals", value: 401 },
          { target: "node", node: "AddPet", op: "notExists" },
        ],
      }),
      opts(fetch),
    )
    expect(saved).toEqual([])
    expect(r.assertions.filter((a) => !a.pass)).toEqual([])
  })

  it("reports the server's reason when it refuses the mocks", async () => {
    // Behind middleware too: the workflow handler refused them, not the middleware.
    const { fetch } = petApp(true, true)
    const r = await runSavedRequest(
      addPet({
        headers: { "x-api-key": "k" },
        mocks: { InsertPet: { error: "database is locked" } },
        expect: [{ target: "status", op: "equals", value: 201 }],
      }),
      opts(fetch),
    )
    expect(r.passed).toBe(false)
    expect(r.error).toMatch(/mocks name nodes this workflow doesn't have: InsertPet/)
  })

  it("fills variables in expected values, keeping a captured number a number", async () => {
    const { fetch } = petApp(true)
    const r = await runSavedRequest(
      addPet({
        expect: [
          { target: "body", path: "id", op: "equals", value: "{{petId}}" },
          { target: "body", path: "name", op: "equals", value: "{{petName}}" },
        ],
      }),
      { ...opts(fetch), vars: { petId: "1", petName: "Rex" } },
    )
    expect(r.assertions.filter((a) => !a.pass)).toEqual([])
    expect(r.missingVariables).toEqual([])
  })

  it("tells a dev server from a built one", async () => {
    expect(await serverHasTestHooks("http://lorien.test", petApp(true).fetch)).toBe(true)
    expect(await serverHasTestHooks("http://lorien.test", petApp(false).fetch)).toBe(false)
  })

  it("skips mocked requests and node checks on a server without test hooks", async () => {
    const { fetch, saved } = petApp(false)
    const mocked = await runSavedRequest(
      addPet({ mocks: { AddPet: { output: { pet: { id: 42, name: "x" } } } } }),
      { ...opts(fetch), testHooks: false },
    )
    expect(saved).toEqual([])
    expect(mocked.skipped).toMatch(/can't apply them/)
    const checked = await runSavedRequest(
      addPet({
        expect: [
          { target: "status", op: "equals", value: 201 },
          { target: "node", node: "AddPet", op: "exists" },
        ],
      }),
      { ...opts(fetch), testHooks: false },
    )
    expect(checked.passed).toBe(true)
    expect(checked.assertions[1]?.skipped).toMatch(/doesn't record traces/)
  })
})

describe("workflow tests without test hooks", () => {
  it("ignores the header, runs the real nodes and fails a mocked request", async () => {
    const { fetch, saved } = petApp(false)
    const r = await runSavedRequest(
      addPet({ mocks: { AddPet: { output: { pet: { id: 42, name: "x" } } } } }),
      opts(fetch),
    )
    expect(saved).toEqual(["Rex"])
    expect(r.passed).toBe(false)
    expect(r.error).toMatch(/didn't apply them/)
  })

  it("fails node checks with a reason", async () => {
    const { fetch } = petApp(false)
    const r = await runSavedRequest(
      addPet({ expect: [{ target: "node", node: "AddPet", op: "exists" }] }),
      opts(fetch),
    )
    expect(r.passed).toBe(false)
    expect(r.assertions[0]?.message).toMatch(
      /sent no trace with its 201 response. Node checks need the dev server/,
    )
  })

  it("does not serve traces", async () => {
    const { fetch } = petApp(false)
    const res = await fetch("http://lorien.test/__lorien/traces/abc", { method: "GET" })
    expect(res.status).toBe(404)
  })
})
