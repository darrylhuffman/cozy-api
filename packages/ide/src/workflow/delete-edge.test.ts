import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { removeMappings } from "./delete-edge"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    request: { uses: "@core/http-request" },
    save: { uses: "./save", in: { email: "request.body.email", password: "request.body.password" } },
    log: { uses: "./log", in: "save.user" },
  },
}

describe("removeMappings", () => {
  it("removes a single per-field mapping", () => {
    const next = removeMappings(wf, [{ source: "request.body.email", target: "save.email" }])
    expect(next.nodes.save?.in).toEqual({ password: "request.body.password" })
  })

  it("removes multiple per-field mappings in one call", () => {
    const next = removeMappings(wf, [
      { source: "request.body.email", target: "save.email" },
      { source: "request.body.password", target: "save.password" },
    ])
    expect(next.nodes.save?.in).toBeUndefined()
  })

  it("clears whole-object string in: when its sole mapping is removed", () => {
    const next = removeMappings(wf, [{ source: "save.user", target: "log" }])
    expect(next.nodes.log?.in).toBeUndefined()
  })

  it("returns wf unchanged when no mappings match", () => {
    const next = removeMappings(wf, [{ source: "x.y", target: "save.email" }])
    expect(next.nodes.save?.in).toEqual(wf.nodes.save?.in) // unchanged because the source doesn't match
  })
})
