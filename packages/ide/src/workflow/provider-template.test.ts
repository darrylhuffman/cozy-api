import { describe, expect, it } from "vitest"
import { providerName, providerTemplate } from "./provider-template"

describe("providerTemplate", () => {
  it("names providers the way the runtime does", () => {
    expect(providerName("http-client")).toBe("httpClient")
    expect(providerName("rate_limiter")).toBe("rateLimiter")
    expect(providerName("db")).toBe("db")
  })

  it("writes a starter per lifetime", () => {
    expect(providerTemplate("db", "singleton")).toContain("env: z.object({})")
    expect(providerTemplate("db", "singleton")).not.toContain("lifetime:")
    expect(providerTemplate("logger", "scoped")).toContain(`lifetime: "scoped"`)
    expect(providerTemplate("clock", "transient")).toContain(`lifetime: "transient"`)
    expect(providerTemplate("http-client", "singleton")).toContain("`httpClient`")
  })
})
