import { describe, expect, it } from "vitest"
import { serializeBody } from "./serialize-body"

const baseForm = {
  triggerNodeId: "trig",
  method: "POST",
  path: "/x",
  bodyKind: "none" as const,
  body: "",
  formBody: [] as Array<[string, string]>,
  query: [] as Array<[string, string]>,
  headers: [] as Array<[string, string]>,
}

describe("serializeBody", () => {
  it("none → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "none" })).toEqual({})
  })

  it("json empty → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "json", body: "   " })).toEqual({})
  })

  it("json valid → parsed object", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "json", body: '{ "a": 1 }' })).toEqual({
      body: { a: 1 },
    })
  })

  it("json invalid → error string", () => {
    const r = serializeBody({ ...baseForm, bodyKind: "json", body: "{ not json" })
    expect(r.body).toBeUndefined()
    expect(r.error).toBeTruthy()
  })

  it("xml → raw string body", () => {
    expect(
      serializeBody({ ...baseForm, bodyKind: "xml", body: "<x>1</x>" }),
    ).toEqual({ body: "<x>1</x>" })
  })

  it("xml empty → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "xml", body: "" })).toEqual({})
  })

  it("text → raw string body (whitespace preserved)", () => {
    expect(
      serializeBody({ ...baseForm, bodyKind: "text", body: "  hello\n" }),
    ).toEqual({ body: "  hello\n" })
  })

  it("form → URL-encoded string, empty keys filtered", () => {
    expect(
      serializeBody({
        ...baseForm,
        bodyKind: "form",
        formBody: [
          ["a", "1"],
          ["", "skip"],
          ["b", "two words"],
        ],
      }),
    ).toEqual({ body: "a=1&b=two+words" })
  })

  it("form with no rows → no body key", () => {
    expect(serializeBody({ ...baseForm, bodyKind: "form", formBody: [] })).toEqual({})
  })
})
