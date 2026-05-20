import { describe, expect, it } from "vitest"
import type { OpenAPIObject } from "./load-spec.js"
import { resolveRef } from "./resolve-ref.js"

function spec(extra: Record<string, unknown> = {}): OpenAPIObject {
  return {
    openapi: "3.0.0",
    info: { title: "test", version: "1" },
    paths: {},
    ...extra,
  } as OpenAPIObject
}

describe("resolveRef", () => {
  it("resolves a simple schema ref", () => {
    const s = spec({
      components: {
        schemas: {
          Pet: { type: "object", properties: { id: { type: "integer" } } },
        },
      },
    })
    const r = resolveRef(s, "#/components/schemas/Pet") as { type: string }
    expect(r.type).toBe("object")
  })

  it("follows chained refs", () => {
    const s = spec({
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/B" },
          B: { type: "object" },
        },
      },
    })
    const r = resolveRef(s, "#/components/schemas/A") as { type: string }
    expect(r.type).toBe("object")
  })

  it("rejects external refs", () => {
    expect(() => resolveRef(spec(), "http://example.com/spec.json#/foo")).toThrow(/External refs/)
  })

  it("rejects missing paths", () => {
    const s = spec({ components: { schemas: { Pet: {} } } })
    expect(() => resolveRef(s, "#/components/schemas/NotExist")).toThrow(/missing/)
  })

  it("detects cycles", () => {
    const s = spec({
      components: {
        schemas: {
          A: { $ref: "#/components/schemas/B" },
          B: { $ref: "#/components/schemas/A" },
        },
      },
    })
    expect(() => resolveRef(s, "#/components/schemas/A")).toThrow(/Cycle/)
  })

  it("decodes ~1 (slash) and ~0 (tilde) in JSON-pointer segments", () => {
    const s = spec({
      paths: {
        "/users/{id}": { summary: "user route" },
      },
    })
    const r = resolveRef(s, "#/paths/~1users~1{id}") as { summary: string }
    expect(r.summary).toBe("user route")
  })
})
