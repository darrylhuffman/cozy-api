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
        req: { uses: "@core/http-request", values: { path: "/add", method: "POST" } },
        add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
        res: { uses: "@core/response", in: { body: "add.sum" }, values: { status: 200 } },
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
        req: { uses: "@core/http-request", values: { path: "/x", method: "GET" } },
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
        req: { uses: "@core/http-request", values: { path: "/", method: "GET" } },
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
        req: { uses: "@core/http-request", values: { path: "/", method: "GET" } },
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
        reqA: { uses: "@core/http-request", values: { path: "/a", method: "GET" } },
        reqB: { uses: "@core/http-request", values: { path: "/b", method: "GET" } },
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

  it("rejects input that fails the node's Zod schema", async () => {
    const strict = defineNode({
      inputs: z.object({ email: z.string().email() }),
      outputs: z.object({ ok: z.boolean() }),
      async run({ email }) {
        return { ok: email.length > 0 }
      },
    })

    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { path: "/", method: "POST" } },
        n: { uses: "./strict", in: { email: "req.body.email" } },
        r: { uses: "@core/response", in: { body: "n.ok" } },
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
          body: { email: "not-an-email" },
          params: {},
          query: {},
          headers: {},
          context: { requestId: "", timestamp: 0 },
        },
        services: {},
        resolveNode: (u) => resolveCoreNode(u) ?? ({ "./strict": strict } as Record<string, ReturnType<typeof defineNode>>)[u] ?? null,
      }),
    ).rejects.toThrow(/input validation failed.*email/i)
  })

  it("passes the parsed (and coerced) input to run()", async () => {
    // z.coerce.number() converts a string "5" to number 5
    let received: unknown = null
    const coerced = defineNode({
      inputs: z.object({ count: z.coerce.number() }),
      outputs: z.object({ ok: z.boolean() }),
      async run(input) {
        received = input
        return { ok: true }
      },
    })

    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { path: "/", method: "POST" } },
        n: { uses: "./coerced", in: { count: "req.body.n" } },
        r: { uses: "@core/response", in: { body: "n.ok" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    await runWorkflow({
      workflow: wf,
      plan,
      triggerNodeId: "req",
      triggerOutputs: {
        body: { n: "42" },
        params: {},
        query: {},
        headers: {},
        context: { requestId: "", timestamp: 0 },
      },
      services: {},
      resolveNode: (u) => resolveCoreNode(u) ?? ({ "./coerced": coerced } as Record<string, ReturnType<typeof defineNode>>)[u] ?? null,
    })
    expect(received).toEqual({ count: 42 }) // string → number via coerce
  })

  describe("whole-object `in` (string form)", () => {
    it("passes the entire resolved value as the input bag", async () => {
      let received: unknown = null
      const echo = defineNode({
        inputs: z.object({ email: z.string(), password: z.string() }),
        outputs: z.object({ ok: z.boolean() }),
        async run(input) {
          received = input
          return { ok: true }
        },
      })

      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/", method: "POST" } },
          n: { uses: "./echo", in: "req.body" },
          r: { uses: "@core/response", in: { body: "n.ok" } },
        },
      })
      const { errors, depsByNode } = validateWorkflow(wf)
      expect(errors).toEqual([])
      const plan = computeExecutionPlan(wf, depsByNode)

      await runWorkflow({
        workflow: wf,
        plan,
        triggerNodeId: "req",
        triggerOutputs: {
          body: { email: "ada@example.com", password: "hunter2" },
          params: {},
          query: {},
          headers: {},
          context: { requestId: "x", timestamp: 0 },
        },
        services: {},
        resolveNode: (u) =>
          resolveCoreNode(u) ??
          ({ "./echo": echo } as Record<string, ReturnType<typeof defineNode>>)[u] ??
          null,
      })

      expect(received).toEqual({ email: "ada@example.com", password: "hunter2" })
    })

    it("emits an edge-fired event with the whole-object sentinel `$`", async () => {
      const emitter = new LifecycleEmitter()
      const edges: { from: string; to: string }[] = []
      emitter.on("edge-fired", (e) => edges.push({ from: e.from, to: e.to }))

      const echo = defineNode({
        inputs: z.object({}).passthrough(),
        outputs: z.object({ ok: z.boolean() }),
        async run() {
          return { ok: true }
        },
      })

      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/", method: "POST" } },
          n: { uses: "./echo", in: "req.body" },
          r: { uses: "@core/response", in: { body: "n.ok" } },
        },
      })
      const { depsByNode } = validateWorkflow(wf)
      const plan = computeExecutionPlan(wf, depsByNode)
      await runWorkflow({
        workflow: wf,
        plan,
        triggerNodeId: "req",
        triggerOutputs: {
          body: { anything: 1 },
          params: {},
          query: {},
          headers: {},
          context: { requestId: "x", timestamp: 0 },
        },
        services: {},
        resolveNode: (u) =>
          resolveCoreNode(u) ??
          ({ "./echo": echo } as Record<string, ReturnType<typeof defineNode>>)[u] ??
          null,
        lifecycle: emitter,
      })

      // The whole-object edge fires with target sentinel `$`
      expect(edges.some((e) => e.to === "n.$" && e.from.startsWith("req."))).toBe(true)
    })

    it("Zod validation still applies to the whole-object form", async () => {
      const strict = defineNode({
        inputs: z.object({ email: z.string().email() }),
        outputs: z.object({ ok: z.boolean() }),
        async run() {
          return { ok: true }
        },
      })
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/", method: "POST" } },
          n: { uses: "./strict", in: "req.body" },
          r: { uses: "@core/response", in: { body: "n.ok" } },
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
            body: { email: "not-an-email" },
            params: {},
            query: {},
            headers: {},
            context: { requestId: "", timestamp: 0 },
          },
          services: {},
          resolveNode: (u) =>
            resolveCoreNode(u) ??
            ({ "./strict": strict } as Record<string, ReturnType<typeof defineNode>>)[u] ??
            null,
        }),
      ).rejects.toThrow(/input validation failed.*email/i)
    })
  })

  describe("values: literal floor", () => {
    it("passes values: as the input bag when no in: refs are set", async () => {
      let received: unknown = null
      const echo = defineNode({
        inputs: z.object({ method: z.string(), path: z.string() }),
        outputs: z.object({ ok: z.boolean() }),
        async run(input) {
          received = input
          return { ok: true }
        },
      })
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/", method: "GET" } },
          n: {
            uses: "./echo",
            values: { method: "POST", path: "/items" },
          },
          r: { uses: "@core/response", in: { body: "n.ok" } },
        },
      })
      const { depsByNode } = validateWorkflow(wf)
      const plan = computeExecutionPlan(wf, depsByNode)
      await runWorkflow({
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
          ({ "./echo": echo } as Record<string, ReturnType<typeof defineNode>>)[u] ??
          null,
      })
      expect(received).toEqual({ method: "POST", path: "/items" })
    })

    it("in: references override values: for the same field", async () => {
      let received: unknown = null
      const echo = defineNode({
        inputs: z.object({ x: z.string(), y: z.string() }),
        outputs: z.object({ ok: z.boolean() }),
        async run(input) {
          received = input
          return { ok: true }
        },
      })
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/", method: "POST" } },
          n: {
            uses: "./echo",
            // x's literal "default" is overridden by the reference; y stays literal.
            values: { x: "default", y: "kept" },
            in: { x: "req.body" },
          },
          r: { uses: "@core/response", in: { body: "n.ok" } },
        },
      })
      const { errors, depsByNode } = validateWorkflow(wf)
      expect(errors).toEqual([])
      const plan = computeExecutionPlan(wf, depsByNode)
      await runWorkflow({
        workflow: wf,
        plan,
        triggerNodeId: "req",
        triggerOutputs: {
          body: "from-request",
          params: {},
          query: {},
          headers: {},
          context: { requestId: "", timestamp: 0 },
        },
        services: {},
        resolveNode: (u) =>
          resolveCoreNode(u) ??
          ({ "./echo": echo } as Record<string, ReturnType<typeof defineNode>>)[u] ??
          null,
      })
      expect(received).toEqual({ x: "from-request", y: "kept" })
    })

    it("rejects non-string per-field in: values at evaluation time", async () => {
      // Per-field `in:` is references-only. A bare bareword like "GET" parses
      // as a reference to a node named "GET" — validate will flag the missing
      // node. Here we go straight to runWorkflow with such a workflow and
      // expect it to throw.
      const echo = defineNode({
        inputs: z.object({}).passthrough(),
        outputs: z.object({}),
        async run() {
          return {}
        },
      })
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          req: { uses: "@core/http-request", values: { path: "/", method: "POST" } },
          n: { uses: "./echo", in: { method: "GET" } },
          r: { uses: "@core/response", in: { body: "n" } },
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
            ({ "./echo": echo } as Record<string, ReturnType<typeof defineNode>>)[u] ??
            null,
        }),
      ).rejects.toThrow()
    })
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
        req: { uses: "@core/http-request", values: { path: "/", method: "GET" } },
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
