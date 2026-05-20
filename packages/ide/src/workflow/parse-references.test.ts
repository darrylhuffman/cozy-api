import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { extractReferences } from "./parse-references.js"

const baseWorkflow = (nodes: WorkflowFile["nodes"]): WorkflowFile => ({
  lorien: 1,
  nodes,
})

describe("extractReferences", () => {
  it("returns empty array when no nodes have in: blocks", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
    })
    expect(extractReferences(wf)).toEqual([])
  })

  it("extracts a simple node reference (nodeId only, no path)", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: { uses: "@core/transform", in: { input: "a" } },
    })
    const refs = extractReferences(wf)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      from: { nodeId: "a", path: [] },
      to: { nodeId: "b", field: "input" },
    })
  })

  it("extracts a dotted reference (nodeId.output.nested)", () => {
    const wf = baseWorkflow({
      parseBody: { uses: "@core/parse-body" },
      validate: { uses: "./validateEmail", in: { email: "parseBody.body.email" } },
    })
    const refs = extractReferences(wf)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      from: { nodeId: "parseBody", path: ["body", "email"] },
      to: { nodeId: "validate", field: "email" },
    })
  })

  it("skips string literals that are not identifier references", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: {
        uses: "@core/transform",
        in: {
          url: "https://example.com/api",   // URL — not a reference
          method: "POST",                    // plain string
          count: "123",                      // numeric string — not a valid identifier start... wait, "123" starts with digit
          template: "Hello, world!",         // contains space — not a reference
        },
      },
    })
    expect(extractReferences(wf)).toHaveLength(0)
  })

  it("skips non-string values in in: blocks", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: {
        uses: "@core/transform",
        in: {
          count: 42,
          flag: true,
          obj: { nested: "a" },
        },
      },
    })
    expect(extractReferences(wf)).toHaveLength(0)
  })

  it("skips references to unknown nodes", () => {
    const wf = baseWorkflow({
      b: { uses: "@core/transform", in: { input: "nonexistentNode" } },
    })
    expect(extractReferences(wf)).toHaveLength(0)
  })

  it("handles multiple references from one node", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/parse-body" },
      c: { uses: "@core/validate" },
      b: { uses: "@core/merge", in: { x: "a", y: "c.result" } },
    })
    const refs = extractReferences(wf)
    expect(refs).toHaveLength(2)
    const nodeIds = refs.map((r) => r.from.nodeId).sort()
    expect(nodeIds).toEqual(["a", "c"])
  })

  it("extracts references from multiple target nodes", () => {
    const wf = baseWorkflow({
      source: { uses: "@core/fetch" },
      consumerA: { uses: "@core/log", in: { data: "source" } },
      consumerB: { uses: "@core/store", in: { payload: "source.body" } },
    })
    const refs = extractReferences(wf)
    expect(refs).toHaveLength(2)
    expect(refs.every((r) => r.from.nodeId === "source")).toBe(true)
  })
})
