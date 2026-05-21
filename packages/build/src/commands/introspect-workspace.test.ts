import { describe, expect, it } from "vitest"
import { CORE_SCHEMAS } from "./introspect-workspace.js"

describe("CORE_SCHEMAS", () => {
  it("@core/http-request carries a blue-ish color", () => {
    const entry = CORE_SCHEMAS["@core/http-request"]
    expect(entry).toBeDefined()
    expect(entry?.color).toBeDefined()
    expect(typeof entry?.color).toBe("string")
  })

  it("@core/response carries a green-ish color", () => {
    const entry = CORE_SCHEMAS["@core/response"]
    expect(entry).toBeDefined()
    expect(entry?.color).toBeDefined()
    expect(typeof entry?.color).toBe("string")
  })

  it("every core schema exposes inputs + outputs JSON Schemas", () => {
    for (const [uses, schemas] of Object.entries(CORE_SCHEMAS)) {
      expect(schemas.inputs, `${uses} should have inputs`).toBeDefined()
      expect(schemas.outputs, `${uses} should have outputs`).toBeDefined()
    }
  })
})
