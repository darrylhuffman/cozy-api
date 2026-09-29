import { describe, expect, it } from "vitest"
import { CORE_SCHEMAS } from "./introspect-workspace.js"

describe("CORE_SCHEMAS", () => {
  it("@core/http-request has no accent color (color is null)", () => {
    const entry = CORE_SCHEMAS["@core/http-request"]
    expect(entry).toBeDefined()
    expect(entry?.color).toBeNull()
  })

  it("@core/response has no accent color (color is null)", () => {
    const entry = CORE_SCHEMAS["@core/response"]
    expect(entry).toBeDefined()
    expect(entry?.color).toBeNull()
  })

  it("@core/http-request schema includes a body input", () => {
    const entry = CORE_SCHEMAS["@core/http-request"]
    expect(entry?.inputs.properties?.["body"]).toBeDefined()
  })

  it("every core schema exposes inputs + outputs JSON Schemas", () => {
    for (const [uses, schemas] of Object.entries(CORE_SCHEMAS)) {
      expect(schemas.inputs, `${uses} should have inputs`).toBeDefined()
      expect(schemas.outputs, `${uses} should have outputs`).toBeDefined()
    }
  })
})
