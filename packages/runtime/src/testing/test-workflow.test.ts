import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { parseWorkflow } from "../workflow/parse.js"
import { testWorkflow, traceWorkflow } from "./index.js"

describe("testWorkflow", () => {
  it("runs a workflow with provided trigger input and returns the response", async () => {
    const add = defineNode({
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b }
      },
    })
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { path: "/add", method: "POST" } },
        add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
        res: { uses: "@core/response", in: { body: "add.sum" }, values: { status: 200 } },
      },
    })
    const res = await testWorkflow(wf, {
      request: { body: { a: 5, b: 7 }, params: {}, query: {}, headers: {} },
      nodes: { "./add": add },
      services: {},
    })
    expect(res.status).toBe(200)
    expect(res.body).toBe(12)
  })

  it("applies partial service overrides on top of config defaults", async () => {
    const node = defineNode({
      inputs: z.object({}),
      outputs: z.object({ msg: z.string() }),
      async run(_, services) {
        return { msg: (services as { greeting: string }).greeting }
      },
    })
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { path: "/", method: "GET" } },
        n: { uses: "./n", in: {} },
        r: { uses: "@core/response", in: { body: "n.msg" } },
      },
    })
    const res = await testWorkflow(wf, {
      request: { body: null, params: {}, query: {}, headers: {} },
      nodes: { "./n": node },
      services: { greeting: "hi" },
    })
    expect(res.body).toBe("hi")
  })
})

describe("traceWorkflow", () => {
  it("captures the input/output of every node", async () => {
    const upper = defineNode({
      inputs: z.object({ s: z.string() }),
      outputs: z.object({ out: z.string() }),
      async run({ s }) {
        return { out: s.toUpperCase() }
      },
    })
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { path: "/", method: "GET" } },
        u: { uses: "./u", in: { s: "req.body" } },
        r: { uses: "@core/response", in: { body: "u.out" } },
      },
    })
    const trace = await traceWorkflow(wf, {
      request: { body: "hello", params: {}, query: {}, headers: {} },
      nodes: { "./u": upper },
      services: {},
    })
    expect(trace.at("u").output).toEqual({ out: "HELLO" })
    expect(trace.response.body).toBe("HELLO")
    expect(trace.errors).toEqual([])
  })
})
