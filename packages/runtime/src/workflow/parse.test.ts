import { describe, expect, it } from "vitest"
import { parseWorkflow } from "./parse.js"

describe("parseWorkflow", () => {
  it("parses a minimal workflow", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: {
        request: { uses: "@core/http-request", config: { path: "/x", method: "GET" } },
        response: { uses: "@core/response", in: { body: "request.params" } },
      },
    })
    expect(wf.nodes.request.uses).toBe("@core/http-request")
    expect(wf.nodes.response.in?.body).toBe("request.params")
  })

  it("rejects unknown version", () => {
    expect(() => parseWorkflow({ cozy: 99, nodes: {} } as unknown)).toThrow(/cozy.*version/i)
  })

  it("rejects when nodes is missing", () => {
    expect(() => parseWorkflow({ cozy: 1 } as unknown)).toThrow()
  })

  it("rejects a node without `uses`", () => {
    expect(() => parseWorkflow({ cozy: 1, nodes: { x: {} as never } } as unknown)).toThrow(/uses/)
  })

  it("accepts optional view block", () => {
    const wf = parseWorkflow({
      cozy: 1,
      nodes: { r: { uses: "@core/response" } },
      view: { r: { x: 10, y: 20 } },
    })
    expect(wf.view?.r).toEqual({ x: 10, y: 20 })
  })
})
