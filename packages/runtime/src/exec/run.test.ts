import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { resolveCoreNode } from "../core/registry.js"
import { defineNode } from "../define-node.js"
import { parseWorkflow } from "../workflow/parse.js"
import { validateWorkflow } from "../workflow/validate.js"
import { LifecycleEmitter } from "./lifecycle.js"
import { runWorkflow } from "./run.js"
import { computeExecutionPlan } from "./topology.js"

function setupSimpleAdd() {
  const add = defineNode({
    name: "Add",
    inputs: z.object({ a: z.number(), b: z.number() }),
    outputs: z.object({ sum: z.number() }),
    async run({ a, b }) {
      return { sum: a + b }
    },
  })
  return add
}

describe("runWorkflow", () => {
  it("executes a single trigger -> compute -> response chain", async () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/add", method: "POST" } },
        add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
        res: { uses: "@core/response", in: { body: "add.sum", status: 200 } },
      },
    })
    const { errors, depsByNode } = validateWorkflow(wf)
    expect(errors).toEqual([])
    const plan = computeExecutionPlan(wf, depsByNode)

    const userNodes: Record<string, ReturnType<typeof setupSimpleAdd>> = {
      "./add": setupSimpleAdd(),
    }

    const result = await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "req",
      triggerOutputs: {
        body: { a: 2, b: 3 },
        params: {},
        query: {},
        headers: {},
        context: { requestId: "x", timestamp: 0 },
      },
      services: {},
      resolveNode: (uses) => resolveCoreNode(uses) ?? userNodes[uses] ?? null,
    })

    expect(result.status).toBe(200)
    expect(result.body).toBe(5)
  })

  it("runs independent branches in parallel and joins them", async () => {
    const A = vi.fn(async () => ({ out: "A" }))
    const B = vi.fn(async () => ({ out: "B" }))
    const join = vi.fn(async ({ a, b }: { a: string; b: string }) => ({ joined: `${a}+${b}` }))

    const nA = defineNode({
      inputs: z.object({}),
      outputs: z.object({ out: z.string() }),
      run: A as never,
    })
    const nB = defineNode({
      inputs: z.object({}),
      outputs: z.object({ out: z.string() }),
      run: B as never,
    })
    const nJoin = defineNode({
      inputs: z.object({ a: z.string(), b: z.string() }),
      outputs: z.object({ joined: z.string() }),
      run: join as never,
    })

    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        a: { uses: "./a", in: {} },
        b: { uses: "./b", in: {} },
        j: { uses: "./join", in: { a: "a.out", b: "b.out" }, after: ["req"] },
        r: { uses: "@core/response", in: { body: "j.joined" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    const userNodes = { "./a": nA, "./b": nB, "./join": nJoin }

    const result = await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "req",
      triggerOutputs: {
        body: null,
        params: {},
        query: {},
        headers: {},
        context: { requestId: "", timestamp: 0 },
      },
      services: {},
      resolveNode: (uses) =>
        resolveCoreNode(uses) ?? ((userNodes as Record<string, unknown>)[uses] as never) ?? null,
    })

    expect(result.body).toBe("A+B")
    expect(A).toHaveBeenCalled()
    expect(B).toHaveBeenCalled()
  })

  it("emits before-node and after-node events for each node", async () => {
    const emitter = new LifecycleEmitter()
    const events: string[] = []
    emitter.on("before-node", (e) => events.push(`before:${e.nodeId}`))
    emitter.on("after-node", (e) => events.push(`after:${e.nodeId}`))

    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/", method: "GET" } },
        res: { uses: "@core/response", in: { body: "req.body" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)

    await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "req",
      triggerOutputs: {
        body: "hi",
        params: {},
        query: {},
        headers: {},
        context: { requestId: "", timestamp: 0 },
      },
      services: {},
      resolveNode: (u) => resolveCoreNode(u),
      lifecycle: emitter,
    })

    expect(events).toContain("before:req")
    expect(events).toContain("after:req")
    expect(events).toContain("before:res")
    expect(events).toContain("after:res")
  })

  it("fail-fast awaits in-flight siblings before throwing", async () => {
    const sideEffectCompleted = vi.fn()
    const slowOk = defineNode({
      inputs: z.object({}),
      outputs: z.object({}),
      async run() {
        await new Promise((r) => setTimeout(r, 20))
        sideEffectCompleted()
        return {}
      },
    })
    const fastFail = defineNode({
      inputs: z.object({}),
      outputs: z.object({}),
      async run() {
        throw new Error("boom")
      },
    })
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/", method: "GET" } },
        slow: { uses: "./slow", in: {}, after: ["req"] },
        fail: { uses: "./fail", in: {}, after: ["req"] },
        r: { uses: "@core/response", in: { body: "slow" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    await expect(
      runWorkflow({
        workflow: wf,
        plan,
        triggerNodeId: "req",
        triggerOutputs: {
          body: null,
          params: {},
          query: {},
          headers: {},
          context: { requestId: "", timestamp: 0 },
        },
        services: {},
        resolveNode: (u) =>
          resolveCoreNode(u) ??
          (
            { "./slow": slowOk, "./fail": fastFail } as Record<
              string,
              ReturnType<typeof defineNode>
            >
          )[u] ??
          null,
      }),
    ).rejects.toThrow(/boom/)
    expect(sideEffectCompleted).toHaveBeenCalled()
  })

  it("multi-trigger workflow: firing one trigger does not run the other trigger's subgraph", async () => {
    const aFn = vi.fn(async () => ({ out: "A" }))
    const bFn = vi.fn(async () => ({ out: "B" }))
    const nA = defineNode({
      inputs: z.object({}),
      outputs: z.object({ out: z.string() }),
      run: aFn as never,
    })
    const nB = defineNode({
      inputs: z.object({}),
      outputs: z.object({ out: z.string() }),
      run: bFn as never,
    })
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        reqA: { uses: "@core/http-request", config: { path: "/a", method: "GET" } },
        reqB: { uses: "@core/http-request", config: { path: "/b", method: "GET" } },
        a: { uses: "./a", in: {}, after: ["reqA"] },
        b: { uses: "./b", in: {}, after: ["reqB"] },
        resA: { uses: "@core/response", in: { body: "a.out" } },
        resB: { uses: "@core/response", in: { body: "b.out" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    const result = await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "reqA",
      triggerOutputs: {
        body: null,
        params: {},
        query: {},
        headers: {},
        context: { requestId: "", timestamp: 0 },
      },
      services: {},
      resolveNode: (u) =>
        resolveCoreNode(u) ??
        ({ "./a": nA, "./b": nB } as Record<string, ReturnType<typeof defineNode>>)[u] ??
        null,
    })
    expect(result.body).toBe("A")
    expect(aFn).toHaveBeenCalledOnce()
    expect(bFn).not.toHaveBeenCalled()
  })

  it("fail-fast: a node throw aborts the workflow with NodeRunError", async () => {
    const boom = defineNode({
      inputs: z.object({}),
      outputs: z.object({}),
      async run() {
        throw new Error("boom")
      },
    })
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/", method: "GET" } },
        b: { uses: "./boom", in: {} },
        r: { uses: "@core/response", in: { body: "b" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)

    await expect(
      runWorkflow({
        workflow: wf,
        plan,
        triggerNodeId: "req",
        triggerOutputs: {
          body: null,
          params: {},
          query: {},
          headers: {},
          context: { requestId: "", timestamp: 0 },
        },
        services: {},
        resolveNode: (u) => resolveCoreNode(u) ?? { "./boom": boom }[u] ?? null,
      }),
    ).rejects.toThrow(/boom/)
  })
})
