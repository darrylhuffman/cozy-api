import { describe, expect, it } from "vitest";

// Mock the resolution of @lorien/ide to a tmp dist so we can test runIde without
// requiring an actual @lorien/ide build.
// Note: this is intentionally lightweight — full integration is via manual smoke.

describe("ide command — registration smoke", () => {
  it("the ide module exports registerIde + runIde", async () => {
    const mod = await import("./ide.js");
    expect(typeof mod.registerIde).toBe("function");
    expect(typeof mod.runIde).toBe("function");
  });
});
