import { describe, expect, it } from "vitest"
import { z } from "zod"
import { resolveCoreNode } from "../core/registry.js"
import { defineNode } from "../define-node.js"
import type { AnyNodeOrTrigger } from "../types.js"
import { parseWorkflow } from "../workflow/parse.js"
import { validateWorkflow } from "../workflow/validate.js"
import { runWorkflow } from "./run.js"
import { computeExecutionPlan } from "./topology.js"

const nodes: Record<string, AnyNodeOrTrigger> = {
  "./check": defineNode({
    inputs: z.object({}),
    outputs: z.object({ ok: z.boolean() }),
    // A node that breaks its own contract, as plain JS or an `as never` would.
    async run() {
      return { ok: "yes" } as never
    },
  }),
}

const workflow = parseWorkflow({
  lorien: 1,
  nodes: {
    Request: { uses: "@core/http-request", values: { path: "/check", method: "GET" } },
    Check: { uses: "./check", after: ["Request"] },
    Response: { uses: "@core/response", in: { body: "Check.ok" }, values: { status: 200 } },
  },
})

function run(mocks?: Record<string, { output?: Record<string, unknown> }>) {
  const { depsByNode } = validateWorkflow(workflow)
  return runWorkflow({
    workflow,
    plan: computeExecutionPlan(workflow, depsByNode),
    triggerNodeId: "Request",
    triggerOutputs: {
      body: null,
      params: {},
      query: {},
      headers: {},
      context: { requestId: "", timestamp: 0 },
    },
    services: {},
    resolveNode: (u) => resolveCoreNode(u) ?? nodes[u] ?? null,
    ...(mocks ? { mocks } : {}),
  })
}

describe("node outputs", () => {
  it("fails at the node whose output breaks its outputs schema", async () => {
    await expect(run()).rejects.toThrow(
      /Node `Check` failed: output doesn't match its outputs schema at `ok`/,
    )
  })

  it("doesn't check mocks, which are partial by design", async () => {
    await expect(run({ Check: { output: { ok: "mocked" } } })).resolves.toMatchObject({
      status: 200,
      body: "mocked",
    })
  })
})
