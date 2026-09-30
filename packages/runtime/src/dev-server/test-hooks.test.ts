import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { type FetchLike, runSavedRequest, type SavedRequest } from "../requests/index.js"
import { parseWorkflow } from "../workflow/parse.js"
import type { LoadedWorkflow } from "./load.js"
import { mountWorkflows } from "./server.js"

// POST /pets → AddPet (writes to a "database") → 201 with the pet.
function petApp(testHooks: boolean) {
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
    expect(r.assertions[0]?.message).toMatch(/node checks need the lorien IDE/)
  })

  it("does not serve traces", async () => {
    const { fetch } = petApp(false)
    const res = await fetch("http://lorien.test/__lorien/traces/abc", { method: "GET" })
    expect(res.status).toBe(404)
  })
})
