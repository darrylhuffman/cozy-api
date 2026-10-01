import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { deleteNode } from "./delete-node"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    request: { uses: "@core/http-request" },
    save: {
      uses: "./nodes/save",
      in: { email: "request.body.email", password: "request.body.password" },
    },
    response: {
      uses: "@core/http-response",
      in: { body: "save.user" },
      values: { status: 201 },
    },
    log: { uses: "./nodes/log", in: "save.user" },
  },
  view: {
    request: { x: 0, y: 0 },
    save: { x: 100, y: 0 },
    response: { x: 200, y: 0 },
    log: { x: 200, y: 100 },
  },
}

describe("deleteNode", () => {
  it("removes the node from `nodes` and `view`", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.save).toBeUndefined()
    expect(next.view?.save).toBeUndefined()
  })

  it("strips per-field `in:` entries pointing at the deleted node", () => {
    const next = deleteNode(wf, "save")
    // body referenced save.user — gone. The `in:` block becomes empty and is dropped.
    expect(next.nodes.response?.in).toBeUndefined()
  })

  it("drops a `when` that reads the deleted node", () => {
    const branching: WorkflowFile = {
      ...wf,
      nodes: {
        ...wf.nodes,
        missing: { uses: "@core/http-response", when: "!save.user", in: { body: "request.body" } },
        other: { uses: "@core/http-response", when: "request.ok" },
      },
    }
    const next = deleteNode(branching, "save")
    expect(next.nodes.missing).toEqual({
      uses: "@core/http-response",
      in: { body: "request.body" },
    })
    expect(next.nodes.other?.when).toBe("request.ok")
  })

  it("clears whole-object `in:` strings pointing at the deleted node", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.log?.in).toBeUndefined() // string-form ref scrubbed
  })

  it("preserves `values:` literals on nodes when deleting (literals are independent of refs)", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.response?.values).toEqual({ status: 201 })
  })

  it("returns wf unchanged when id doesn't exist", () => {
    const next = deleteNode(wf, "nonexistent")
    expect(next).toEqual(wf)
  })

  it("does not mutate the input", () => {
    const before = JSON.stringify(wf)
    deleteNode(wf, "save")
    expect(JSON.stringify(wf)).toBe(before)
  })
})
