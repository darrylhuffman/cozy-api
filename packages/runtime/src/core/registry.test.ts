import { describe, expect, it } from "vitest"
import { CORE_NODE_IDS, isCoreReference, resolveCoreNode } from "./registry.js"

describe("core node registry", () => {
  it("exposes http-request and response", () => {
    expect(CORE_NODE_IDS).toEqual(expect.arrayContaining(["@core/http-request", "@core/response"]))
  })

  it("isCoreReference matches @core/* uses", () => {
    expect(isCoreReference("@core/http-request")).toBe(true)
    expect(isCoreReference("./nodes/foo")).toBe(false)
  })

  it("resolveCoreNode returns the trigger object", () => {
    const t = resolveCoreNode("@core/http-request")
    expect(t?.kind).toBe("trigger")
  })

  it("resolveCoreNode returns null for unknown core ids", () => {
    expect(resolveCoreNode("@core/nonexistent")).toBeNull()
  })

  it("@core/http-request defaults path to {workflow_path}", () => {
    const t = resolveCoreNode("@core/http-request")
    if (!t || t.kind !== "trigger" || !t.config) throw new Error("trigger has no config")
    const parsed = t.config.parse({})
    expect(parsed.path).toBe("{workflow_path}")
    expect(parsed.method).toBe("GET")
  })
})
