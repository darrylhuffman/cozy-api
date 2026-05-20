import { describe, expect, it } from "vitest"
import { VERSION } from "./index.js"

describe("@darrylondil/lorien-openapi package", () => {
  it("exports a version string", () => {
    expect(VERSION).toBe("0.0.0")
  })
})
