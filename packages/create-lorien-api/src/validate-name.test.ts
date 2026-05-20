import { describe, expect, it } from "vitest"
import { validateName } from "./validate-name.js"

describe("validateName", () => {
  it("accepts simple lowercase names", () => {
    expect(validateName("my-app").ok).toBe(true)
    expect(validateName("foo").ok).toBe(true)
    expect(validateName("a-b-c-123").ok).toBe(true)
  })

  it("accepts scoped names", () => {
    expect(validateName("@scope/name").ok).toBe(true)
  })

  it("rejects empty", () => {
    expect(validateName("").ok).toBe(false)
  })

  it("rejects uppercase", () => {
    const r = validateName("MyApp")
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/lowercase/)
  })

  it("rejects leading dot or underscore", () => {
    expect(validateName(".hidden").ok).toBe(false)
    expect(validateName("_private").ok).toBe(false)
  })

  it("rejects spaces and special chars", () => {
    expect(validateName("my app").ok).toBe(false)
    expect(validateName("my!app").ok).toBe(false)
  })

  it("rejects over-length names", () => {
    expect(validateName("a".repeat(215)).ok).toBe(false)
  })
})
