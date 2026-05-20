import { describe, expect, it } from "vitest"
import { parseWorkflow } from "../workflow/parse.js"
import { validateWorkflow } from "../workflow/validate.js"
import { computeExecutionPlan } from "./topology.js"

describe("computeExecutionPlan", () => {
  it("groups nodes by dependency wave", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        a: { uses: "./n", in: { v: "req.body" } },
        b: { uses: "./n", in: { v: "req.body" } },
        join: { uses: "./n", in: { x: "a.out", y: "b.out" } },
        res: { uses: "@core/response", in: { body: "join.out" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    expect(plan.waves).toEqual([
      ["req"],
      ["a", "b"], // parallel
      ["join"],
      ["res"],
    ])
  })

  it("groups all independent triggers in wave 0", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        getReq: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        postReq: { uses: "@core/http-request", config: { path: "/x", method: "POST" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    expect(plan.waves[0]?.sort()).toEqual(["getReq", "postReq"])
  })

  it("returns reachable-from-trigger node sets", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        getReq: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        postReq: { uses: "@core/http-request", config: { path: "/x", method: "POST" } },
        getOnly: { uses: "./n", in: { v: "getReq.body" } },
        postOnly: { uses: "./n", in: { v: "postReq.body" } },
        getRes: { uses: "@core/response", in: { body: "getOnly.out" } },
        postRes: { uses: "@core/response", in: { body: "postOnly.out" } },
      },
    })
    const { depsByNode } = validateWorkflow(wf)
    const plan = computeExecutionPlan(wf, depsByNode)
    expect(plan.reachableFrom.get("getReq")).toEqual(new Set(["getReq", "getOnly", "getRes"]))
    expect(plan.reachableFrom.get("postReq")).toEqual(new Set(["postReq", "postOnly", "postRes"]))
  })
})
