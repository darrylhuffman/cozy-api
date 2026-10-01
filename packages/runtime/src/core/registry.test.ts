import { describe, expect, it } from "vitest"
import {
  CORE_NODE_IDS,
  canonicalCoreId,
  coreCategory,
  isCoreReference,
  isHttpResponse,
  resolveCoreNode,
} from "./registry.js"

describe("core node registry", () => {
  it("exposes the trigger, logic, data and response nodes", () => {
    expect(CORE_NODE_IDS).toEqual(
      expect.arrayContaining([
        "@core/http-request",
        "@core/http-response",
        "@core/variable",
        "@core/if",
        "@core/switch",
        "@core/and",
        "@core/or",
        "@core/not",
      ]),
    )
  })

  it("files every core node under a folder", () => {
    expect(coreCategory("@core/http-request")).toBe("triggers")
    expect(coreCategory("@core/switch")).toBe("logic")
    expect(coreCategory("@core/variable")).toBe("data")
    expect(coreCategory("@core/http-response")).toBe("responses")
  })

  it("still resolves @core/response, the old name of @core/http-response", () => {
    expect(canonicalCoreId("@core/response")).toBe("@core/http-response")
    expect(resolveCoreNode("@core/response")).toBe(resolveCoreNode("@core/http-response"))
    expect(isHttpResponse("@core/response")).toBe(true)
    expect(CORE_NODE_IDS).not.toContain("@core/response")
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
