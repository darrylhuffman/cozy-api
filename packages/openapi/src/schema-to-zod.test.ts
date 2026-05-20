import { describe, expect, it } from "vitest"
import type { OpenAPIObject } from "./load-spec.js"
import { newContext, schemaToZod } from "./schema-to-zod.js"

function spec(): OpenAPIObject {
  return { openapi: "3.0.0", info: { title: "x", version: "1" }, paths: {} } as OpenAPIObject
}

describe("schemaToZod — primitives", () => {
  it("string", () => {
    expect(schemaToZod({ type: "string" }, spec())).toBe("z.string()")
  })

  it("string with email format", () => {
    expect(schemaToZod({ type: "string", format: "email" }, spec())).toBe("z.string().email()")
  })

  it("string with uuid format", () => {
    expect(schemaToZod({ type: "string", format: "uuid" }, spec())).toBe("z.string().uuid()")
  })

  it("string with date-time format", () => {
    expect(schemaToZod({ type: "string", format: "date-time" }, spec())).toBe(
      "z.string().datetime()",
    )
  })

  it("string with date format", () => {
    expect(schemaToZod({ type: "string", format: "date" }, spec())).toBe("z.string().date()")
  })

  it("string with uri format", () => {
    expect(schemaToZod({ type: "string", format: "uri" }, spec())).toBe("z.string().url()")
  })

  it("string with url format", () => {
    expect(schemaToZod({ type: "string", format: "url" }, spec())).toBe("z.string().url()")
  })

  it("string with uuid + length constraints", () => {
    expect(
      schemaToZod({ type: "string", format: "uuid", minLength: 36, maxLength: 36 }, spec()),
    ).toMatch(/z\.string\(\)\.uuid\(\)\.min\(36\)\.max\(36\)/)
  })

  it("string with minLength only", () => {
    expect(schemaToZod({ type: "string", minLength: 3 }, spec())).toBe("z.string().min(3)")
  })

  it("string with maxLength only", () => {
    expect(schemaToZod({ type: "string", maxLength: 100 }, spec())).toBe("z.string().max(100)")
  })

  it("integer with bounds", () => {
    expect(schemaToZod({ type: "integer", minimum: 0, maximum: 100 }, spec())).toBe(
      "z.number().int().min(0).max(100)",
    )
  })

  it("integer with no bounds", () => {
    expect(schemaToZod({ type: "integer" }, spec())).toBe("z.number().int()")
  })

  it("number (no .int())", () => {
    expect(schemaToZod({ type: "number" }, spec())).toBe("z.number()")
  })

  it("number with min/max", () => {
    expect(schemaToZod({ type: "number", minimum: 0.5, maximum: 99.9 }, spec())).toBe(
      "z.number().min(0.5).max(99.9)",
    )
  })

  it("boolean", () => {
    expect(schemaToZod({ type: "boolean" }, spec())).toBe("z.boolean()")
  })

  it("enum", () => {
    expect(schemaToZod({ type: "string", enum: ["a", "b", "c"] }, spec())).toBe(
      `z.enum(["a", "b", "c"] as const)`,
    )
  })

  it("enum with numeric-looking strings stays quoted", () => {
    expect(schemaToZod({ type: "string", enum: ["active", "inactive"] }, spec())).toBe(
      `z.enum(["active", "inactive"] as const)`,
    )
  })
})

describe("schemaToZod — composites", () => {
  it("array of strings", () => {
    expect(schemaToZod({ type: "array", items: { type: "string" } }, spec())).toBe(
      "z.array(z.string())",
    )
  })

  it("array of integers", () => {
    expect(schemaToZod({ type: "array", items: { type: "integer" } }, spec())).toBe(
      "z.array(z.number().int())",
    )
  })

  it("array with no items becomes z.array(z.unknown())", () => {
    expect(schemaToZod({ type: "array" }, spec())).toBe("z.array(z.unknown())")
  })

  it("object with required + optional fields", () => {
    const out = schemaToZod(
      {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
        },
        required: ["id", "email"],
      },
      spec(),
    )
    expect(out).toMatch(/z\.object\(/)
    expect(out).toMatch(/"id": z\.number\(\)\.int\(\)/)
    expect(out).toMatch(/"name": z\.string\(\)\.optional\(\)/)
    expect(out).toMatch(/"email": z\.string\(\)\.email\(\)/)
    // email is required so must NOT have .optional()
    expect(out).not.toMatch(/"email": z\.string\(\)\.email\(\)\.optional\(\)/)
  })

  it("object with no required array — everything optional", () => {
    const out = schemaToZod(
      {
        type: "object",
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
        },
      },
      spec(),
    )
    expect(out).toMatch(/"id": z\.number\(\)\.int\(\)\.optional\(\)/)
    expect(out).toMatch(/"name": z\.string\(\)\.optional\(\)/)
  })

  it("object with empty required array — everything optional", () => {
    const out = schemaToZod(
      {
        type: "object",
        properties: { id: { type: "integer" } },
        required: [],
      },
      spec(),
    )
    expect(out).toMatch(/"id": z\.number\(\)\.int\(\)\.optional\(\)/)
  })

  it("object with no properties becomes z.record", () => {
    expect(schemaToZod({ type: "object" }, spec())).toBe("z.record(z.string(), z.unknown())")
  })

  it("object with empty properties becomes z.record", () => {
    expect(schemaToZod({ type: "object", properties: {} }, spec())).toBe(
      "z.record(z.string(), z.unknown())",
    )
  })

  it("nested object", () => {
    const out = schemaToZod(
      {
        type: "object",
        properties: {
          address: {
            type: "object",
            properties: { street: { type: "string" } },
            required: ["street"],
          },
        },
        required: ["address"],
      },
      spec(),
    )
    expect(out).toMatch(/z\.object\(/)
    expect(out).toMatch(/"street": z\.string\(\)/)
  })
})

describe("schemaToZod — nullability", () => {
  it("OAS 3.0 nullable string", () => {
    expect(schemaToZod({ type: "string", nullable: true }, spec())).toBe("z.string().nullable()")
  })

  it("OAS 3.0 nullable integer", () => {
    expect(schemaToZod({ type: "integer", nullable: true }, spec())).toBe(
      "z.number().int().nullable()",
    )
  })

  it("OAS 3.1 type array including null", () => {
    expect(schemaToZod({ type: ["string", "null"] } as never, spec())).toBe("z.string().nullable()")
  })

  it("non-nullable string has no .nullable()", () => {
    expect(schemaToZod({ type: "string" }, spec())).not.toContain(".nullable()")
  })
})

describe("schemaToZod — refs", () => {
  it("resolves a ref", () => {
    const s: OpenAPIObject = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {},
      components: {
        schemas: {
          Pet: {
            type: "object",
            properties: { id: { type: "integer" } },
            required: ["id"],
          },
        },
      },
    } as OpenAPIObject
    const out = schemaToZod({ $ref: "#/components/schemas/Pet" } as never, s)
    expect(out).toMatch(/z\.object\(\{ "id": z\.number\(\)\.int\(\) \}\)/)
  })

  it("resolves a ref to a primitive", () => {
    const s: OpenAPIObject = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {},
      components: {
        schemas: { MyString: { type: "string", format: "email" } },
      },
    } as OpenAPIObject
    expect(schemaToZod({ $ref: "#/components/schemas/MyString" } as never, s)).toBe(
      "z.string().email()",
    )
  })

  it("handles cyclic refs by emitting z.unknown()", () => {
    const s: OpenAPIObject = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {},
      components: {
        schemas: {
          Tree: {
            type: "object",
            properties: {
              children: { type: "array", items: { $ref: "#/components/schemas/Tree" } },
            },
          },
        },
      },
    } as OpenAPIObject
    const ctx = newContext()
    const out = schemaToZod({ $ref: "#/components/schemas/Tree" } as never, s, ctx)
    expect(out).toMatch(/z\.unknown/)
    expect(ctx.warnings.some((w) => w.includes("Cyclic"))).toBe(true)
  })

  it("siblings refs don't share cycle state", () => {
    // Two refs to the same schema in sibling properties should both resolve correctly
    const s: OpenAPIObject = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {},
      components: {
        schemas: { Tag: { type: "string" } },
      },
    } as OpenAPIObject
    const out = schemaToZod(
      {
        type: "object",
        properties: {
          a: { $ref: "#/components/schemas/Tag" },
          b: { $ref: "#/components/schemas/Tag" },
        },
        required: ["a", "b"],
      } as never,
      s,
    )
    // Both should resolve to z.string(), not z.unknown()
    expect(out).toMatch(/"a": z\.string\(\)/)
    expect(out).toMatch(/"b": z\.string\(\)/)
  })
})

describe("schemaToZod — unsupported", () => {
  it("allOf emits z.unknown with comment + warning", () => {
    const ctx = newContext()
    const out = schemaToZod({ allOf: [{ type: "object" }] } as never, spec(), ctx)
    expect(out).toMatch(/z\.unknown/)
    expect(out).toContain("TODO")
    expect(ctx.warnings.length).toBeGreaterThan(0)
    expect(ctx.warnings[0]).toContain("allOf")
  })

  it("oneOf emits z.unknown with comment + warning", () => {
    const ctx = newContext()
    const out = schemaToZod(
      { oneOf: [{ type: "string" }, { type: "number" }] } as never,
      spec(),
      ctx,
    )
    expect(out).toMatch(/z\.unknown/)
    expect(ctx.warnings.length).toBeGreaterThan(0)
  })

  it("anyOf emits z.unknown with comment + warning", () => {
    const ctx = newContext()
    const out = schemaToZod({ anyOf: [{ type: "string" }] } as never, spec(), ctx)
    expect(out).toMatch(/z\.unknown/)
    expect(ctx.warnings.length).toBeGreaterThan(0)
  })

  it("missing type emits z.unknown with warning", () => {
    const ctx = newContext()
    const out = schemaToZod({} as never, spec(), ctx)
    expect(out).toBe("z.unknown()")
    expect(ctx.warnings.length).toBeGreaterThan(0)
  })

  it("unknown type emits z.unknown with warning", () => {
    const ctx = newContext()
    const out = schemaToZod({ type: "exotic-future-type" } as never, spec(), ctx)
    expect(out).toBe("z.unknown()")
    expect(ctx.warnings.length).toBeGreaterThan(0)
  })
})
