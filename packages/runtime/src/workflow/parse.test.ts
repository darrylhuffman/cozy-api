import { describe, expect, it } from "vitest"
import { parseWorkflow, parseWorkflowFromString, WorkflowParseError } from "./parse.js"

describe("parseWorkflow", () => {
  it("parses a minimal workflow", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: {
        request: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        response: { uses: "@core/response", in: { body: "request.params" } },
      },
    })
    expect(wf.nodes.request.uses).toBe("@core/http-request")
    expect(wf.nodes.response.in?.body).toBe("request.params")
  })

  it("rejects unknown version", () => {
    expect(() => parseWorkflow({ lorien: 99, nodes: {} } as unknown)).toThrow(/lorien.*version/i)
  })

  it("rejects when nodes is missing", () => {
    expect(() => parseWorkflow({ lorien: 1 } as unknown)).toThrow()
  })

  it("rejects a node without `uses`", () => {
    expect(() => parseWorkflow({ lorien: 1, nodes: { x: {} as never } } as unknown)).toThrow(/uses/)
  })

  it("accepts optional view block", () => {
    const wf = parseWorkflow({
      lorien: 1,
      nodes: { r: { uses: "@core/response" } },
      view: { r: { x: 10, y: 20 } },
    })
    expect(wf.view?.r).toEqual({ x: 10, y: 20 })
  })
})

describe("parseWorkflowFromString", () => {
  it("parses valid JSON workflow source", () => {
    const wf = parseWorkflowFromString(
      JSON.stringify({
        lorien: 1,
        nodes: { r: { uses: "@core/response" } },
      }),
    )
    expect(wf.nodes.r?.uses).toBe("@core/response")
  })

  it("throws WorkflowParseError on invalid JSON syntax", () => {
    expect(() => parseWorkflowFromString("{not json")).toThrow(WorkflowParseError)
    expect(() => parseWorkflowFromString("{not json")).toThrow(/JSON/i)
  })

  it("throws WorkflowParseError on schema-invalid JSON", () => {
    expect(() => parseWorkflowFromString(JSON.stringify({ lorien: 1 }))).toThrow(WorkflowParseError)
  })
})
