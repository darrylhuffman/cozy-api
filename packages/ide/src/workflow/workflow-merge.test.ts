import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { mergeWorkflows } from "./workflow-merge"

const base: WorkflowFile = {
  lorien: 1,
  nodes: {
    Request: { uses: "@core/http-request", values: { path: "/pets", method: "GET" } },
    List: { uses: "./nodes/list", in: { status: "Request.query.status" }, values: { limit: 10 } },
    Response: { uses: "@core/http-response", in: { body: "List.pets" } },
  },
  view: { Request: { x: 0, y: 0 }, List: { x: 300, y: 0 }, Response: { x: 600, y: 0 } },
} as WorkflowFile

const clone = (): WorkflowFile => structuredClone(base)

describe("mergeWorkflows", () => {
  it("combines changes to different nodes and different inputs of one node", () => {
    const ours = clone()
    ours.nodes.List!.values = { limit: 20 }
    ours.nodes.Note = { uses: "@core/variable", values: { value: "hi" } }
    const theirs = clone()
    ;(theirs.nodes.List!.in as Record<string, string>).species = "Request.query.species"
    theirs.nodes.Response!.values = { status: 200 }
    theirs.view!.Response = { x: 700, y: 50 }

    const r = mergeWorkflows(base, ours, theirs)
    expect(r.conflicts).toEqual([])
    expect(r.combined).toEqual(["List"])
    expect(r.merged.nodes.List).toEqual({
      uses: "./nodes/list",
      in: { status: "Request.query.status", species: "Request.query.species" },
      values: { limit: 20 },
    })
    expect(r.merged.nodes.Note).toBeDefined()
    expect(r.merged.nodes.Response!.values).toEqual({ status: 200 })
    expect(r.merged.view!.Response).toEqual({ x: 700, y: 50 })
  })

  it("reports the same input changed two ways, and lets each side win", () => {
    const ours = clone()
    ours.nodes.List!.values = { limit: 20 }
    const theirs = clone()
    theirs.nodes.List!.values = { limit: 50 }
    theirs.nodes.List!.uses = "./nodes/list-v2"

    const r = mergeWorkflows(base, ours, theirs)
    expect(r.conflicts.map((c) => [c.nodeId, c.fields])).toEqual([["List", ["values.limit"]]])
    // Their non-conflicting change still comes through.
    expect(r.merged.nodes.List!.uses).toBe("./nodes/list-v2")
    expect(r.merged.nodes.List!.values).toEqual({ limit: 20 })
    const t = mergeWorkflows(base, ours, theirs, { List: "theirs" })
    expect(t.merged.nodes.List!.values).toEqual({ limit: 50 })
  })

  it("treats a node removed on one side and changed on the other as a whole-node conflict", () => {
    const ours = clone()
    delete ours.nodes.List
    const theirs = clone()
    theirs.nodes.List!.values = { limit: 5 }

    const r = mergeWorkflows(base, ours, theirs)
    expect(r.conflicts).toMatchObject([{ nodeId: "List", fields: ["node"] }])
    expect(r.merged.nodes.List).toBeUndefined()
    expect(
      mergeWorkflows(base, ours, theirs, { List: "theirs" }).merged.nodes.List!.values,
    ).toEqual({
      limit: 5,
    })
    // Removed on one side, untouched on the other: removed.
    const quiet = mergeWorkflows(base, ours, clone())
    expect(quiet.conflicts).toEqual([])
    expect(quiet.merged.nodes.List).toBeUndefined()
  })

  it("keeps the whole-input form", () => {
    const b = clone()
    b.nodes.Response!.in = "List"
    const ours = structuredClone(b)
    const theirs = structuredClone(b)
    theirs.nodes.Response!.in = "List.pets"
    expect(mergeWorkflows(b, ours, theirs).merged.nodes.Response!.in).toBe("List.pets")
  })
})
