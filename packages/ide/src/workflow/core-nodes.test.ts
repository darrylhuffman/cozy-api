import { describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import {
  branchLabel,
  caseLabel,
  isBranchPort,
  isHttpResponse,
  removeSwitchCase,
  setSwitchCases,
} from "./core-nodes"

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    Request: { uses: "@core/http-request" },
    Kind: {
      uses: "@core/switch",
      in: { value: "Request.query" },
      values: { cases: ["a", "b", 3] },
    },
    A: { uses: "@core/http-response", when: "Kind.case1" },
    B: { uses: "@core/http-response", when: "!Kind.case2" },
    C: { uses: "./nodes/c", when: "Kind.case3", in: { x: "Kind.case3", y: "Kind.value" } },
    D: { uses: "@core/http-response", when: "Kind.default" },
  },
} as WorkflowFile

describe("core nodes", () => {
  it("knows the response node under both names", () => {
    expect(isHttpResponse("@core/http-response")).toBe(true)
    expect(isHttpResponse("@core/response")).toBe(true)
    expect(isHttpResponse("@core/variable")).toBe(false)
  })

  it("tells branch outputs from data outputs", () => {
    expect(isBranchPort("@core/switch", "case2")).toBe(true)
    expect(isBranchPort("@core/switch", "default")).toBe(true)
    expect(isBranchPort("@core/switch", "value")).toBe(false)
    expect(isBranchPort("@core/if", "false")).toBe(true)
    expect(isBranchPort("@core/and", "result")).toBe(false)
    expect(isBranchPort("./nodes/x", "true")).toBe(false)
  })

  it("labels a case by its value", () => {
    expect(caseLabel("cat")).toBe("cat")
    expect(caseLabel("")).toBe('""')
    expect(caseLabel(3)).toBe("3")
    expect(branchLabel(wf, "Kind", ["case3"])).toBe("= 3")
    expect(branchLabel(wf, "Kind", ["default"])).toBe("default")
    expect(branchLabel(wf, "Kind", ["value"])).toBeNull()
  })

  it("adds cases", () => {
    const next = setSwitchCases(wf, "Kind", ["a", "b", 3, "d"])
    expect(next.nodes.Kind?.values?.cases).toEqual(["a", "b", 3, "d"])
    expect(next.nodes.Kind?.in).toEqual({ value: "Request.query" })
  })

  it("removes a case, dropping what read it and renumbering later ones", () => {
    const next = removeSwitchCase(wf, "Kind", 1)
    expect(next.nodes.Kind?.values?.cases).toEqual(["a", 3])
    expect(next.nodes.A?.when).toBe("Kind.case1")
    expect(next.nodes.B?.when).toBeUndefined()
    expect(next.nodes.C?.when).toBe("Kind.case2")
    expect(next.nodes.C?.in).toEqual({ x: "Kind.case2", y: "Kind.value" })
    expect(next.nodes.D?.when).toBe("Kind.default")
  })
})
