import { describe, expect, it } from "vitest"
import { sampleFromSchema } from "./sample-from-schema"
import type { JsonSchema } from "@/lib/api"

describe("sampleFromSchema", () => {
  it("returns null for null/undefined", () => {
    expect(sampleFromSchema(null)).toBeNull()
  })

  it('returns default if present (over enum, over type)', () => {
    const schema: JsonSchema = { type: "string", default: "preset", enum: ["a", "b"] }
    expect(sampleFromSchema(schema)).toBe("preset")
  })

  it("returns the first enum value when enum is non-empty", () => {
    expect(sampleFromSchema({ type: "string", enum: ["GET", "POST"] })).toBe("GET")
  })

  it("string type → empty string", () => {
    expect(sampleFromSchema({ type: "string" })).toBe("")
  })

  it("number/integer type → 0", () => {
    expect(sampleFromSchema({ type: "number" })).toBe(0)
    expect(sampleFromSchema({ type: "integer" })).toBe(0)
  })

  it("boolean type → false", () => {
    expect(sampleFromSchema({ type: "boolean" })).toBe(false)
  })

  it("array type → empty array (no item synthesis in v1)", () => {
    expect(
      sampleFromSchema({
        type: "array",
        items: { type: "string" },
      }),
    ).toEqual([])
  })

  it("object recurses over properties; missing properties → empty object", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        email: { type: "string" },
        age: { type: "integer" },
        active: { type: "boolean" },
      },
    }
    expect(sampleFromSchema(schema)).toEqual({
      email: "",
      age: 0,
      active: false,
    })
  })

  it("nested objects recurse", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
    }
    expect(sampleFromSchema(schema)).toEqual({ user: { name: "" } })
  })

  it("object with no properties → empty object", () => {
    expect(sampleFromSchema({ type: "object" })).toEqual({})
  })

  it("unknown type → null", () => {
    expect(sampleFromSchema({ type: "weird" as never })).toBeNull()
  })

  it("schema with no type and no enum → null", () => {
    expect(sampleFromSchema({})).toBeNull()
  })

  it("enum with one value → that value (preserves type)", () => {
    expect(sampleFromSchema({ enum: [42] })).toBe(42)
  })
})
