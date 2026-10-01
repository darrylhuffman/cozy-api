import { CORE_NODE_IDS, coreCategory } from "@darrylondil/lorien-runtime"
import { describe, expect, it } from "vitest"
import { CORE_SCHEMAS } from "./introspect-workspace.js"

describe("CORE_SCHEMAS", () => {
  it("@core/http-request has no accent color (color is null)", () => {
    const entry = CORE_SCHEMAS["@core/http-request"]
    expect(entry).toBeDefined()
    expect(entry?.color).toBeNull()
  })

  it("@core/http-response has no accent color (color is null)", () => {
    const entry = CORE_SCHEMAS["@core/http-response"]
    expect(entry).toBeDefined()
    expect(entry?.color).toBeNull()
  })

  it("@core/http-request schema includes a body input", () => {
    const entry = CORE_SCHEMAS["@core/http-request"]
    expect(entry?.inputs.properties?.body).toBeDefined()
  })

  it("every core schema exposes inputs + outputs JSON Schemas", () => {
    for (const [uses, schemas] of Object.entries(CORE_SCHEMAS)) {
      expect(schemas.inputs, `${uses} should have inputs`).toBeDefined()
      expect(schemas.outputs, `${uses} should have outputs`).toBeDefined()
    }
  })
  it("covers every node in the runtime's core registry, in the same folder", () => {
    for (const uses of CORE_NODE_IDS) {
      expect(CORE_SCHEMAS[uses], uses).toBeDefined()
      expect(CORE_SCHEMAS[uses]?.category, uses).toBe(coreCategory(uses))
    }
  })

  it("keeps @core/response loadable, marked as renamed", () => {
    expect(CORE_SCHEMAS["@core/response"]?.renamedTo).toBe("@core/http-response")
  })
})
