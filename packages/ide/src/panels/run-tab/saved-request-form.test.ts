import { describe, expect, it } from "vitest"
import { requestIdFromName } from "@/store/request-collections"
import { formatValue, parseValue } from "./assertions-editor"
import { formToSavedRequest, savedRequestToForm } from "./saved-request-form"

const meta = { id: "x", name: "X", expect: [], capture: [] as Array<[string, string]> }

describe("form <-> saved request", () => {
  it("round-trips every body kind", () => {
    for (const body of [
      { kind: "json" as const, json: { a: ["{{b}}"] } },
      { kind: "text" as const, text: "hi" },
      { kind: "xml" as const, text: "<a/>" },
      { kind: "form" as const, form: { a: "1" } },
    ]) {
      const req = { id: "x", name: "X", method: "POST", path: "/p", trigger: "t", body }
      const back = formToSavedRequest(savedRequestToForm(req, null), meta)
      expect(back.request).toEqual(req)
    }
  })

  it("drops blank header/query rows and empty bodies", () => {
    const r = formToSavedRequest(
      {
        triggerNodeId: null,
        method: "GET",
        path: "/",
        bodyKind: "json",
        body: "  ",
        formBody: [],
        query: [["", "x"]],
        headers: [
          ["A", "1"],
          [" ", "2"],
        ],
      },
      { ...meta, name: " ", capture: [["id", "body.id"]] },
    )
    expect(r.request).toEqual({
      id: "x",
      name: "GET /",
      method: "GET",
      path: "/",
      headers: { A: "1" },
      capture: { id: "body.id" },
    })
  })
})

describe("helpers", () => {
  it("makes readable unique ids", () => {
    expect(requestIdFromName("Creates a user!", [])).toBe("createsAUser")
    expect(requestIdFromName("Creates a user", ["createsAUser"])).toBe("createsAUser2")
    expect(requestIdFromName("---", [])).toBe("request")
  })

  it("parses check values as JSON when they look like JSON", () => {
    expect(parseValue("201")).toBe(201)
    expect(parseValue("true")).toBe(true)
    expect(parseValue('{"a":1}')).toEqual({ a: 1 })
    expect(parseValue("hello")).toBe("hello")
    expect(parseValue('"quoted"')).toBe('"quoted"')
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
    expect(formatValue("x")).toBe("x")
  })
})
