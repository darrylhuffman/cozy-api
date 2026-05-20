import { describe, expect, it } from "vitest"
import { VERSION } from "./index.js"

describe("@cozy/runtime package", () => {
  it("exports a version string", () => {
    expect(VERSION).toBe("0.0.0")
  })
})
