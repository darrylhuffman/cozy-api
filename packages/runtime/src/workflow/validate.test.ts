import { describe, expect, it } from "vitest"
import { parseWorkflow } from "./parse.js"
import { validateWorkflow } from "./validate.js"

describe("validateWorkflow", () => {
  it("accepts a valid workflow", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        request: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        response: { uses: "@core/response", in: { body: "request.body" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors).toEqual([])
  })

  it("rejects references to unknown nodes", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        response: { uses: "@core/response", in: { body: "nonexistent.value" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toMatch(/nonexistent/)
  })

  it("rejects after-references to unknown nodes", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        a: { uses: "@core/response", after: ["missing"] },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors.some((e) => /missing/.test(e.message))).toBe(true)
  })

  it("detects direct cycles", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        a: { uses: "./n", in: { x: "b.y" } },
        b: { uses: "./n", in: { y: "a.x" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors.some((e) => /cycle/i.test(e.message))).toBe(true)
  })

  it("detects cycles through `after`", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        a: { uses: "./n", after: ["b"] },
        b: { uses: "./n", after: ["a"] },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors.some((e) => /cycle/i.test(e.message))).toBe(true)
  })

  describe("whole-object `in` (string form)", () => {
    it("accepts a string reference to a known node and tracks the dep", () => {
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          request: { uses: "@core/http-request", config: { path: "/x", method: "POST" } },
          save: { uses: "./nodes/save", in: "request.body" },
        },
      })
      const result = validateWorkflow(wf)
      expect(result.errors).toEqual([])
      // dep on `request` should be tracked
      expect(result.depsByNode.get("save")?.has("request")).toBe(true)
    })

    it("rejects a string reference to an unknown node", () => {
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          save: { uses: "./nodes/save", in: "nonexistent.body" },
        },
      })
      const result = validateWorkflow(wf)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.message).toMatch(/nonexistent/)
      expect(result.errors[0]?.field).toBe("in")
    })

    it("rejects a literal string (not a parseable reference)", () => {
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          save: { uses: "./nodes/save", in: "not a reference!" },
        },
      })
      const result = validateWorkflow(wf)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.message).toMatch(/must be a node reference/)
    })

    it("detects cycles when whole-object `in` participates", () => {
      const wf = parseWorkflow({
        lorien: 1,
        nodes: {
          a: { uses: "./n", in: "b.x" },
          b: { uses: "./n", in: "a.y" },
        },
      })
      const result = validateWorkflow(wf)
      expect(result.errors.some((e) => /cycle/i.test(e.message))).toBe(true)
    })
  })

  it("allows multi-incoming dependencies (joins)", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        a: { uses: "./n", in: { v: "req.body" } },
        b: { uses: "./n", in: { v: "req.body" } },
        join: { uses: "./n", in: { x: "a.out", y: "b.out" } },
      },
    })
    const result = validateWorkflow(wf)
    expect(result.errors).toEqual([])
  })
})
