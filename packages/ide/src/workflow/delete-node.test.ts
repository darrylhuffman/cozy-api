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
      uses: "@core/response",
      in: { body: "save.user", status: 201 },
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
    expect(next.nodes.response?.in).toEqual({ status: 201 }) // body removed
  })

  it("clears whole-object `in:` strings pointing at the deleted node", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.log?.in).toBeUndefined() // string-form ref scrubbed
  })

  it("does not strip references that are literal values", () => {
    const next = deleteNode(wf, "save")
    expect(next.nodes.response?.in).toMatchObject({ status: 201 })
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
