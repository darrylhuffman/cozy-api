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

  it("extracts a simple node reference (nodeId only, no path) — portId defaults to 'out'", () => {
    const wf = baseWorkflow({
      a: { uses: "@core/http-request" },
      b: { uses: "@core/transform", in: { input: "a" } },
    })
    const refs = extractReferences(wf)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      source: { nodeId: "a", portId: "out", remainingPath: [] },
      target: { nodeId: "b", portId: "input" },
    })
  })

  it("extracts a single-level dotted reference (nodeId.port)", () => {
    const wf = baseWorkflow({
      parseBody: { uses: "@core/parse-body" },
      validate: { uses: "./validateEmail", in: { email: "parseBody.body" } },
    })
    const refs = extractReferences(wf)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      source: { nodeId: "parseBody", portId: "body", remainingPath: [] },
      target: { nodeId: "validate", portId: "email" },
    })
  })

  it("extracts a deep dotted reference (nodeId.port.nested) with remainingPath", () => {
    const wf = baseWorkflow({
      parseBody: { uses: "@core/parse-body" },
      validate: { uses: "./validateEmail", in: { email: "parseBody.body.email" } },
    })
    const refs = extractReferences(wf)
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({
      source: { nodeId: "parseBody", portId: "body", remainingPath: ["email"] },
      target: { nodeId: "validate", portId: "email" },
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
        // The schema disallows non-string `in:` values, but parse-references
        // defends against malformed input by silently skipping them.
        in: {
          count: 42 as unknown as string,
          flag: true as unknown as string,
          obj: { nested: "a" } as unknown as string,
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
    const nodeIds = refs.map((r) => r.source.nodeId).sort()
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
    expect(refs.every((r) => r.source.nodeId === "source")).toBe(true)
  })

  describe("whole-object `in` (string form)", () => {
    it("emits one reference with target.portId = '' (root) when `in:` is a string", () => {
      const wf = baseWorkflow({
        request: { uses: "@core/http-request" },
        save: { uses: "./nodes/save", in: "request.body" },
      })
      const refs = extractReferences(wf)
      expect(refs).toHaveLength(1)
      expect(refs[0]).toMatchObject({
        source: { nodeId: "request", portId: "body", remainingPath: [] },
        target: { nodeId: "save", portId: "" },
      })
    })

    it("handles deep dotted whole-object reference", () => {
      const wf = baseWorkflow({
        req: { uses: "@core/http-request" },
        save: { uses: "./nodes/save", in: "req.body.user" },
      })
      const refs = extractReferences(wf)
      expect(refs).toHaveLength(1)
      expect(refs[0]).toMatchObject({
        source: { nodeId: "req", portId: "body", remainingPath: ["user"] },
        target: { nodeId: "save", portId: "" },
      })
    })

    it("ignores whole-object form that doesn't parse as a reference", () => {
      const wf = baseWorkflow({
        save: { uses: "./nodes/save", in: "not a reference" },
      })
      expect(extractReferences(wf)).toHaveLength(0)
    })

    it("ignores whole-object form pointing at an unknown node", () => {
      const wf = baseWorkflow({
        save: { uses: "./nodes/save", in: "unknown.body" },
      })
      expect(extractReferences(wf)).toHaveLength(0)
    })
  })

  it("basic-api create.workflow references — portId and remainingPath correct", () => {
    const wf = baseWorkflow({
      request: { uses: "@core/http-request" },
      save: {
        uses: "./nodes/users/save-user",
        in: {
          email: "request.body.email",
          password: "request.body.password",
        },
      },
      response: {
        uses: "@core/response",
        in: { body: "save.user" },
        values: { status: 201 },
      },
    })
    const refs = extractReferences(wf)
    // 3 string references (status lives under values:, not in:)
    expect(refs).toHaveLength(3)

    const emailRef = refs.find((r) => r.target.portId === "email")!
    expect(emailRef).toMatchObject({
      source: { nodeId: "request", portId: "body", remainingPath: ["email"] },
      target: { nodeId: "save", portId: "email" },
    })

    const passwordRef = refs.find((r) => r.target.portId === "password")!
    expect(passwordRef).toMatchObject({
      source: { nodeId: "request", portId: "body", remainingPath: ["password"] },
      target: { nodeId: "save", portId: "password" },
    })

    const bodyRef = refs.find((r) => r.target.portId === "body")!
    expect(bodyRef).toMatchObject({
      source: { nodeId: "save", portId: "user", remainingPath: [] },
      target: { nodeId: "response", portId: "body" },
    })
  })
})
