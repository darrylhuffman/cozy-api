import { describe, expect, it } from "vitest"
import { LifecycleEmitter } from "../../exec/lifecycle.js"
import { runWorkflow } from "../../exec/run.js"
import { computeExecutionPlan } from "../../exec/topology.js"
import { parseWorkflow } from "../../workflow/parse.js"
import { validateWorkflow } from "../../workflow/validate.js"
import { resolveCoreNode } from "../registry.js"
import { looseEquals, pickField, switchBranches, testCondition } from "./compare.js"

describe("switchBranches", () => {
  it("sets the first matching case and nothing else", () => {
    expect(switchBranches("b", undefined, ["a", "b", "b"])).toEqual({
      case1: false,
      case2: true,
      case3: false,
      default: false,
    })
  })

  it("falls through to default when no case matches", () => {
    expect(switchBranches("z", undefined, ["a"])).toEqual({ case1: false, default: true })
    expect(switchBranches("z", undefined, [])).toEqual({ default: true })
  })

  it("compares an attribute of an object value", () => {
    const user = { profile: { role: "admin" } }
    expect(switchBranches(user, "profile.role", ["user", "admin"]).case2).toBe(true)
  })

  it("matches a query string against a number case", () => {
    expect(switchBranches("2", undefined, [1, 2]).case2).toBe(true)
  })
})

describe("testCondition", () => {
  it.each([
    [1, "is truthy", undefined, true],
    [0, "is falsy", undefined, true],
    ["a", "==", "a", true],
    ["a", "!=", "a", false],
    ["10", ">", 9, true],
    [3, "<=", 3, true],
    ["b", "<", "a", false],
    [null, ">", 1, false],
    ["hello", "contains", "ell", true],
    [["x", "y"], "contains", "y", true],
    [{ id: 1 }, "contains", "id", true],
    ["hello", "starts with", "he", true],
    ["hello", "ends with", "lo", true],
    [[], "is empty", undefined, true],
    [{}, "is not empty", undefined, false],
    [0, "exists", undefined, true],
    [undefined, "exists", undefined, false],
  ])("%j %s %j is %s", (left, op, right, expected) => {
    expect(testCondition(left, op, right)).toBe(expected)
  })

  it("reads an unknown operator as is truthy", () => {
    expect(testCondition("x", undefined, undefined)).toBe(true)
  })
})

describe("helpers", () => {
  it("pickField walks a dotted path and tolerates misses", () => {
    expect(pickField({ a: { b: 2 } }, "a.b")).toBe(2)
    expect(pickField({ a: null }, "a.b")).toBeUndefined()
    expect(pickField(5, "")).toBe(5)
  })

  it("looseEquals compares objects by content", () => {
    expect(looseEquals({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(looseEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(looseEquals([1], { 0: 1 })).toBe(false)
  })
})

describe("logic nodes in a workflow", () => {
  const workflow = parseWorkflow({
    lorien: 1,
    nodes: {
      Request: { uses: "@core/http-request", values: { path: "/pets", method: "GET" } },
      Kind: {
        uses: "@core/switch",
        in: { value: "Request.query" },
        values: { field: "kind", cases: ["cat", "dog"] },
      },
      Cats: { uses: "@core/http-response", when: "Kind.case1", values: { body: "meow" } },
      Dogs: { uses: "@core/http-response", when: "Kind.case2", values: { body: "woof" } },
      Big: {
        uses: "@core/if",
        when: "Kind.default",
        in: { value: "Request.query.size" },
        values: { operator: ">", compare: 10 },
      },
      Huge: { uses: "@core/http-response", when: "Big.true", values: { body: "huge" } },
      Other: { uses: "@core/response", when: "Big.false", values: { status: 404 } },
    },
  })

  async function run(query: Record<string, string>, lifecycle?: LifecycleEmitter) {
    const { errors, depsByNode } = validateWorkflow(workflow)
    expect(errors).toEqual([])
    return runWorkflow({
      workflow,
      plan: computeExecutionPlan(workflow, depsByNode),
      triggerNodeId: "Request",
      triggerOutputs: {
        body: null,
        params: {},
        query,
        headers: {},
        context: { requestId: "", timestamp: 0 },
      },
      services: {},
      resolveNode: resolveCoreNode,
      ...(lifecycle ? { lifecycle } : {}),
    })
  }

  it("runs only the matching switch branch", async () => {
    expect((await run({ kind: "cat" })).body).toBe("meow")
    expect((await run({ kind: "dog" })).body).toBe("woof")
  })

  it("takes the default branch into an if/else", async () => {
    expect((await run({ kind: "fish", size: "40" })).body).toBe("huge")
    expect((await run({ kind: "fish", size: "2" })).status).toBe(404)
  })

  it("skips the branches not taken", async () => {
    const lifecycle = new LifecycleEmitter()
    const skipped: string[] = []
    lifecycle.on("skipped", (e) => {
      skipped.push(e.nodeId)
    })
    await run({ kind: "cat" }, lifecycle)
    expect(skipped).toEqual(expect.arrayContaining(["Dogs", "Big"]))
  })
})
