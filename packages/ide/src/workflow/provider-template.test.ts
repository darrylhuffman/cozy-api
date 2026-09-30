import { describe, expect, it } from "vitest"
import { providerTemplate, SELECTOR_PATTERN, selectorRead } from "./provider-template"

describe("providerTemplate", () => {
  it("writes the selector and the lifetime", () => {
    expect(providerTemplate("db", "singleton")).toContain(`selector: "db",`)
    expect(providerTemplate("db", "singleton")).toContain("env: z.object({})")
    expect(providerTemplate("db", "singleton")).not.toContain("lifetime:")
    expect(providerTemplate("logger", "scoped")).toContain(`lifetime: "scoped"`)
    expect(providerTemplate("clock", "transient")).toContain(`lifetime: "transient"`)
  })
})

describe("selectors", () => {
  it("allow camelCase, PascalCase, snake_case and dashes", () => {
    for (const s of ["db", "PetStore", "rate_limiter", "http-client"]) {
      expect(SELECTOR_PATTERN.test(s)).toBe(true)
    }
    for (const s of ["", "1db", "_db", "my db", "db.users"]) {
      expect(SELECTOR_PATTERN.test(s)).toBe(false)
    }
  })

  it("quote a dashed selector where nodes read it", () => {
    expect(selectorRead("httpClient")).toBe("{ httpClient }")
    expect(selectorRead("http-client")).toBe(`providers["http-client"]`)
  })
})
