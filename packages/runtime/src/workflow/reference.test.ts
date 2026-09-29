import { describe, expect, it } from "vitest"
import { isReferenceString, parseReference } from "./reference.js"

describe("parseReference", () => {
  it("parses a single identifier as nodeId with empty path", () => {
    expect(parseReference("request")).toEqual({ nodeId: "request", path: [] })
  })

  it("parses a dotted path", () => {
    expect(parseReference("request.body.email")).toEqual({
      nodeId: "request",
      path: ["body", "email"],
    })
  })

  it("rejects invalid identifiers", () => {
    expect(parseReference("123abc")).toBeNull()
    expect(parseReference("foo bar")).toBeNull()
    expect(parseReference("")).toBeNull()
    expect(parseReference("foo..bar")).toBeNull()
  })

  it("accepts identifiers with $ and _", () => {
    expect(parseReference("$root.user_id")).toEqual({
      nodeId: "$root",
      path: ["user_id"],
    })
  })
})

describe("isReferenceString", () => {
  it("returns true for valid reference strings", () => {
    expect(isReferenceString("parseBody.email")).toBe(true)
    expect(isReferenceString("node")).toBe(true)
  })

  it("returns false for strings that don't match the reference grammar", () => {
    expect(isReferenceString("hello world")).toBe(false)
    expect(isReferenceString("123abc")).toBe(false)
  })

  it("returns false for non-string values", () => {
    expect(isReferenceString(42)).toBe(false)
    expect(isReferenceString(null)).toBe(false)
    expect(isReferenceString({ x: 1 })).toBe(false)
  })
})
