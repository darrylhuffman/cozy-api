import { describe, expect, it } from "vitest"
import { parseReference, resolveInputValue } from "./reference.js"

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

describe("resolveInputValue", () => {
  it("treats valid reference strings as references", () => {
    expect(resolveInputValue("parseBody.email")).toEqual({
      kind: "reference",
      ref: { nodeId: "parseBody", path: ["email"] },
    })
  })

  it("treats non-reference strings as literals", () => {
    expect(resolveInputValue("hello world")).toEqual({
      kind: "literal",
      value: "hello world",
    })
  })

  it("treats numbers, booleans, and arrays as literals", () => {
    expect(resolveInputValue(201)).toEqual({ kind: "literal", value: 201 })
    expect(resolveInputValue(true)).toEqual({ kind: "literal", value: true })
    expect(resolveInputValue([1, 2, 3])).toEqual({ kind: "literal", value: [1, 2, 3] })
  })

  it("treats nested objects as literals (NOT recursively scanned for refs)", () => {
    expect(resolveInputValue({ a: 1, b: "x" })).toEqual({
      kind: "literal",
      value: { a: 1, b: "x" },
    })
  })

  it("unwraps {$literal: ...} into a plain literal", () => {
    expect(resolveInputValue({ $literal: "parseBody" })).toEqual({
      kind: "literal",
      value: "parseBody",
    })
    expect(resolveInputValue({ $literal: { nested: 1 } })).toEqual({
      kind: "literal",
      value: { nested: 1 },
    })
  })
})
