import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { duplicateNode, renameNode, tidyLayout } from "./graph-ops"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    "http-request": { uses: "@core/http-request", values: { path: "/u" } },
    save: {
      uses: "./nodes/save",
      in: { email: "http-request.body.email", other: "http-requestX.y" },
      after: ["http-request"],
    },
    response: { uses: "@core/response", in: "save.user" },
  },
  view: { "http-request": { x: 1, y: 2 }, save: { x: 3, y: 4 }, response: { x: 5, y: 6 } },
}

describe("renameNode", () => {
  it("renames the node and rewrites references, after lists and view", () => {
    const next = renameNode(wf, "http-request", "request")
    expect(Object.keys(next.nodes)).toEqual(["request", "save", "response"])
    expect(next.nodes.save?.in).toEqual({ email: "request.body.email", other: "http-requestX.y" })
    expect(next.nodes.save?.after).toEqual(["request"])
    expect(next.view?.request).toEqual({ x: 1, y: 2 })
    expect(next.view?.["http-request"]).toBeUndefined()
  })

  it("rewrites whole-object references", () => {
    const next = renameNode(wf, "save", "saveUser")
    expect(next.nodes.response?.in).toBe("saveUser.user")
  })

  it("rewrites when conditions, keeping a leading !", () => {
    const branching: WorkflowFile = {
      lorien: 1,
      nodes: {
        find: { uses: "./nodes/find" },
        missing: { uses: "@core/response", when: "!find.found" },
        found: { uses: "@core/response", when: "find.found" },
      },
    }
    const next = renameNode(branching, "find", "findRoom")
    expect(next.nodes.missing?.when).toBe("!findRoom.found")
    expect(next.nodes.found?.when).toBe("findRoom.found")
  })

  it("is a no-op for unknown ids, same ids, or a taken target", () => {
    expect(renameNode(wf, "nope", "x")).toBe(wf)
    expect(renameNode(wf, "save", "save")).toBe(wf)
    expect(renameNode(wf, "save", "response")).toBe(wf)
  })
})

describe("duplicateNode", () => {
  it("copies the node under a fresh id, offset from the original", () => {
    const r = duplicateNode(wf, "save")!
    expect(r.id).toBe("save2")
    expect(r.workflow.nodes.save2).toEqual(wf.nodes.save)
    expect(r.workflow.nodes.save2).not.toBe(wf.nodes.save)
    expect(r.workflow.view?.save2).toEqual({ x: 43, y: 44 })
  })

  it("numbers from the base of an already-numbered id", () => {
    const once = duplicateNode(wf, "save")!.workflow
    expect(duplicateNode(once, "save2")!.id).toBe("save3")
  })

  it("returns null for an unknown node", () => {
    expect(duplicateNode(wf, "ghost")).toBeNull()
  })
})

describe("tidyLayout", () => {
  it("places each node one column right of its deepest dependency", () => {
    const next = tidyLayout(wf, { columnGap: 300 })
    expect(next.view?.["http-request"]?.x).toBe(40)
    expect(next.view?.save?.x).toBe(340)
    expect(next.view?.response?.x).toBe(640)
  })

  it("stacks nodes in the same column without overlap, keeping their order", () => {
    const fan: WorkflowFile = {
      lorien: 1,
      nodes: {
        a: { uses: "x" },
        b: { uses: "x", in: { v: "a.o" } },
        c: { uses: "x", in: { v: "a.o" } },
      },
      view: { a: { x: 0, y: 0 }, b: { x: 0, y: 500 }, c: { x: 0, y: 100 } },
    }
    const next = tidyLayout(fan, { heights: { c: 200 }, rowGap: 10 })
    expect(next.view?.c).toEqual({ x: 360, y: 40 })
    expect(next.view?.b).toEqual({ x: 360, y: 250 })
  })

  it("tolerates cycles", () => {
    const cyc: WorkflowFile = {
      lorien: 1,
      nodes: { a: { uses: "x", in: { v: "b.o" } }, b: { uses: "x", in: { v: "a.o" } } },
    }
    expect(() => tidyLayout(cyc)).not.toThrow()
  })
})
