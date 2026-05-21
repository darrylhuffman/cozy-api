import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { resetNodeConnections } from "./reset-node-connections"

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

describe("resetNodeConnections", () => {
  it("strips the target node's own `in:` block", () => {
    const next = resetNodeConnections(wf, "save")
    expect(next.nodes.save?.in).toBeUndefined()
  })

  it("leaves the node itself in place (uses, config, etc.)", () => {
    const next = resetNodeConnections(wf, "save")
    expect(next.nodes.save).toBeDefined()
    expect(next.nodes.save?.uses).toBe("./nodes/save")
  })

  it("leaves the node's view/position in place", () => {
    const next = resetNodeConnections(wf, "save")
    expect(next.view?.save).toEqual({ x: 100, y: 0 })
  })

  it("strips per-field `in:` entries in other nodes pointing at the reset node", () => {
    const next = resetNodeConnections(wf, "save")
    // response.body referenced "save.user" — should be stripped
    expect((next.nodes.response?.in as Record<string, unknown>)?.body).toBeUndefined()
    // status: 201 literal is not a reference — should remain
    expect((next.nodes.response?.in as Record<string, unknown>)?.status).toBe(201)
  })

  it("strips whole-object string `in:` in other nodes pointing at the reset node", () => {
    const next = resetNodeConnections(wf, "save")
    // log.in was "save.user" (whole-object form) — should be stripped
    expect(next.nodes.log?.in).toBeUndefined()
  })

  it("leaves unrelated references intact", () => {
    // save.in references "request.body.email" etc — resetting "log" should not touch save
    const next = resetNodeConnections(wf, "log")
    expect(next.nodes.save?.in).toEqual({
      email: "request.body.email",
      password: "request.body.password",
    })
    expect(next.nodes.response?.in).toEqual({ body: "save.user", status: 201 })
  })

  it("is a no-op for a missing id", () => {
    const next = resetNodeConnections(wf, "nonexistent")
    expect(next).toEqual(wf)
  })

  it("does not mutate the input workflow", () => {
    const before = JSON.stringify(wf)
    resetNodeConnections(wf, "save")
    expect(JSON.stringify(wf)).toBe(before)
  })

  it("handles a node that has no `in:` block (idempotent)", () => {
    const next = resetNodeConnections(wf, "request")
    expect(next.nodes.request?.in).toBeUndefined()
    expect(next.nodes.request?.uses).toBe("@core/http-request")
  })
})
