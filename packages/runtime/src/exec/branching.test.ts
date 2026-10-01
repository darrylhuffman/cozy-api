import { describe, expect, it } from "vitest"
import { z } from "zod"
import { resolveCoreNode } from "../core/registry.js"
import { defineNode } from "../define-node.js"
import type { AnyNodeOrTrigger } from "../types.js"
import { parseWorkflow } from "../workflow/parse.js"
import { validateWorkflow } from "../workflow/validate.js"
import { NoResponseError, RequestValidationError } from "./errors.js"
import { LifecycleEmitter } from "./lifecycle.js"
import { runWorkflow } from "./run.js"
import { computeExecutionPlan } from "./topology.js"

const ROOMS: Record<string, { name: string }> = { r1: { name: "Oak" } }
let inserts = 0

const nodes: Record<string, AnyNodeOrTrigger> = {
  "./find-room": defineNode({
    inputs: z.object({ id: z.string() }),
    outputs: z.object({ found: z.boolean(), room: z.object({ name: z.string() }).optional() }),
    async run({ id }) {
      const room = ROOMS[id]
      return room ? { found: true, room } : { found: false }
    },
  }),
  "./book": defineNode({
    inputs: z.object({ room: z.object({ name: z.string() }) }),
    outputs: z.object({ booked: z.string() }),
    async run({ room }) {
      inserts++
      return { booked: room.name }
    },
  }),
  "./capacity": defineNode({
    inputs: z.object({ min: z.coerce.number().int().positive() }),
    outputs: z.object({ min: z.number() }),
    async run({ min }) {
      return { min }
    },
  }),
}

const workflow = parseWorkflow({
  lorien: 1,
  nodes: {
    Request: { uses: "@core/http-request", values: { path: "/rooms/:id/book", method: "POST" } },
    FindRoom: { uses: "./find-room", in: { id: "Request.params.id" } },
    NotFound: {
      uses: "@core/http-response",
      when: "!FindRoom.found",
      values: { status: 404, body: { error: "room not found" } },
    },
    Book: { uses: "./book", when: "FindRoom.found", in: { room: "FindRoom.room" } },
    Booked: { uses: "@core/http-response", in: { body: "Book" }, values: { status: 201 } },
  },
})

async function run(params: Record<string, string>, lifecycle?: LifecycleEmitter) {
  const { errors, depsByNode } = validateWorkflow(workflow)
  expect(errors).toEqual([])
  return runWorkflow({
    workflow,
    plan: computeExecutionPlan(workflow, depsByNode),
    triggerNodeId: "Request",
    triggerOutputs: {
      body: null,
      params,
      query: {},
      headers: {},
      context: { requestId: "", timestamp: 0 },
    },
    services: {},
    resolveNode: (u) => resolveCoreNode(u) ?? nodes[u] ?? null,
    ...(lifecycle ? { lifecycle } : {}),
  })
}

describe("when", () => {
  it("runs the branch whose condition holds", async () => {
    inserts = 0
    const r = await run({ id: "r1" })
    expect(r).toMatchObject({ status: 201, body: { booked: "Oak" } })
    expect(inserts).toBe(1)
  })

  it("skips a false branch and everything reading it; the other response answers", async () => {
    inserts = 0
    const lifecycle = new LifecycleEmitter()
    const skipped: string[] = []
    lifecycle.on("skipped", (e) => skipped.push(e.nodeId))
    const r = await run({ id: "nope" }, lifecycle)
    expect(r).toMatchObject({ status: 404, body: { error: "room not found" } })
    expect(inserts).toBe(0)
    expect(skipped).toEqual(["Book"])
  })

  it("rejects a `when` that isn't a reference, or names an unknown node", () => {
    const bad = parseWorkflow({
      lorien: 1,
      nodes: {
        a: { uses: "@core/http-response", when: "not a ref" },
        b: { uses: "@core/http-response", when: "!Missing.ok" },
      },
    })
    expect(validateWorkflow(bad).errors.map((e) => `${e.nodeId}.${e.field}`)).toEqual([
      "a.when",
      "b.when",
    ])
  })

  it("rejects unknown keys on a node instead of dropping them", () => {
    expect(() =>
      parseWorkflow({
        lorien: 1,
        nodes: { Request: { uses: "@core/http-request", config: { path: "/calc" } } },
      }),
    ).toThrow(/nodes\.Request.*config/s)
  })
})

describe("request validation", () => {
  const wf = parseWorkflow({
    lorien: 1,
    nodes: {
      Request: { uses: "@core/http-request", values: { path: "/rooms", method: "GET" } },
      Capacity: { uses: "./capacity", in: { min: "Request.query.minCapacity" } },
      Again: { uses: "./capacity", in: { min: "Capacity.min" }, values: {} },
      Response: { uses: "@core/http-response", in: { body: "Again.min" } },
    },
  })
  const exec = (query: Record<string, string>) => {
    const { depsByNode } = validateWorkflow(wf)
    return runWorkflow({
      workflow: wf,
      plan: computeExecutionPlan(wf, depsByNode),
      triggerNodeId: "Request",
      triggerOutputs: { body: null, params: {}, query, headers: {}, context: {} },
      services: {},
      resolveNode: (u) => resolveCoreNode(u) ?? nodes[u] ?? null,
    })
  }

  it("names the request field when a value from the request fails a schema", async () => {
    const err = await exec({ minCapacity: "abc" }).catch((e) => e)
    expect(err).toBeInstanceOf(RequestValidationError)
    expect(err.issues).toEqual([{ path: "query.minCapacity", message: expect.any(String) }])
  })

  it("passes valid input through", async () => {
    await expect(exec({ minCapacity: "4" })).resolves.toMatchObject({ body: 4 })
  })
})

describe("no Response ran", () => {
  it("fails the run instead of answering 200 with a null body", async () => {
    const noNotFound = parseWorkflow({
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request", values: { path: "/rooms/:id", method: "GET" } },
        FindRoom: { uses: "./find-room", in: { id: "Request.params.id" } },
        Ok: { uses: "@core/response", when: "FindRoom.found", in: { body: "FindRoom.room" } },
      },
    })
    const { depsByNode } = validateWorkflow(noNotFound)
    const go = (id: string) =>
      runWorkflow({
        workflow: noNotFound,
        plan: computeExecutionPlan(noNotFound, depsByNode),
        triggerNodeId: "Request",
        triggerOutputs: { body: null, params: { id }, query: {}, headers: {}, context: {} },
        services: {},
        resolveNode: (u) => resolveCoreNode(u) ?? nodes[u] ?? null,
      })
    expect((await go("r1")).body).toEqual({ name: "Oak" })
    const err = await go("nope").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NoResponseError)
    expect((err as Error).message).toContain("skipped: Ok")
  })

  it("lets a schedule finish without a Response", async () => {
    const job = parseWorkflow({
      lorien: 1,
      nodes: {
        Tick: { uses: "@core/schedule", values: { cron: "0 * * * *" } },
        FindRoom: { uses: "./find-room", values: { id: "r1" } },
      },
    })
    const { depsByNode } = validateWorkflow(job)
    const result = await runWorkflow({
      workflow: job,
      plan: computeExecutionPlan(job, depsByNode),
      triggerNodeId: "Tick",
      triggerOutputs: { scheduledAt: "", timestamp: 0, manual: true, context: {} },
      services: {},
      resolveNode: (u) => resolveCoreNode(u) ?? nodes[u] ?? null,
    })
    expect(result).toEqual({ status: 200, body: null, headers: {} })
  })
})
