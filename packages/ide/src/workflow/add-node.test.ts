import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { addNode, nodeIdFromUses } from "./add-node"

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

  it("derives a referenceable camelCase id from the last segment of `uses`", () => {
    const next = addNode(baseWorkflow, "./nodes/users/save-user", { x: 0, y: 0 })
    const newId = Object.keys(next.nodes).find((id) => id !== "request")!
    expect(newId).toBe("saveUser")
  })

  it("appends an integer suffix on collision", () => {
    const wf: WorkflowFile = {
      ...baseWorkflow,
      nodes: { ...baseWorkflow.nodes, saveUser: { uses: "./x" } },
    }
    const next = addNode(wf, "./nodes/users/save-user", { x: 0, y: 0 })
    const newIds = Object.keys(next.nodes).filter((id) => id !== "request" && id !== "saveUser")
    expect(newIds).toEqual(["saveUser2"])
  })

  it.each([
    ["@core/http-request", "httpRequest"],
    ["./nodes/users/save-user.ts", "saveUser"],
    ["./nodes/Parse_Body", "parseBody"],
    ["./nodes/2fa-check", "n2faCheck"],
  ])("nodeIdFromUses(%s) → %s, always a valid identifier", (uses, id) => {
    expect(nodeIdFromUses(uses)).toBe(id)
    expect(/^[a-zA-Z_$][\w$]*$/.test(nodeIdFromUses(uses))).toBe(true)
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
