import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { addNode } from "./add-node"

const baseWorkflow: WorkflowFile = {
  lorien: 1,
  nodes: { request: { uses: "@core/http-request" } },
  view: { request: { x: 0, y: 0 } },
}

describe("addNode", () => {
  it("adds a new node with a unique id and the given uses + position", () => {
    const next = addNode(baseWorkflow, "@core/response", { x: 200, y: 100 })
    expect(Object.keys(next.nodes)).toHaveLength(2)
    const newId = Object.keys(next.nodes).find((id) => id !== "request")!
    expect(next.nodes[newId]).toEqual({ uses: "@core/response" })
    expect(next.view![newId]).toEqual({ x: 200, y: 100 })
  })

  it("derives the id from the last segment of `uses` slugified", () => {
    const next = addNode(baseWorkflow, "./nodes/users/save-user", { x: 0, y: 0 })
    const newId = Object.keys(next.nodes).find((id) => id !== "request")!
    expect(newId).toBe("save-user")
  })

  it("appends an integer suffix on collision", () => {
    const wf: WorkflowFile = {
      ...baseWorkflow,
      nodes: { ...baseWorkflow.nodes, "save-user": { uses: "./x" } },
    }
    const next = addNode(wf, "./nodes/users/save-user", { x: 0, y: 0 })
    const newIds = Object.keys(next.nodes).filter((id) => id !== "request" && id !== "save-user")
    expect(newIds).toEqual(["save-user-2"])
  })

  it("strips the @core/ prefix for @core nodes", () => {
    const next = addNode(baseWorkflow, "@core/response", { x: 0, y: 0 })
    const newId = Object.keys(next.nodes).find((id) => id !== "request")!
    expect(newId).toBe("response")
  })

  it("does not mutate the original workflow", () => {
    const before = JSON.stringify(baseWorkflow)
    addNode(baseWorkflow, "@core/response", { x: 0, y: 0 })
    expect(JSON.stringify(baseWorkflow)).toBe(before)
  })
})
