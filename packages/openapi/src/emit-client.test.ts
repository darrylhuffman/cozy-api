import { describe, expect, it } from "vitest"
import { emitClientProvider, selectorFromSlug } from "./emit-client.js"

describe("emitClientProvider", () => {
  it("declares the base URL as provider env, defaulting to the given URL", () => {
    const out = emitClientProvider("petstore", {
      selector: "petstore",
      defaultBaseUrl: "https://petstore.example.com/v3",
    })
    expect(out).toContain(`selector: "petstore"`)
    expect(out).toContain(
      `env: z.object({ PETSTORE_BASE_URL: z.string().url().default("https://petstore.example.com/v3") })`,
    )
    // Nodes may not read process.env; the provider's env schema replaces it.
    expect(out).not.toContain("process.env")
  })

  it("requires the env var when there is no default, and underscores a dashed slug", () => {
    const out = emitClientProvider("foo-bar", { selector: "fooBar" })
    expect(out).toContain(`env: z.object({ FOO_BAR_BASE_URL: z.string().url() })`)
  })

  it("sends JSON by default", () => {
    const out = emitClientProvider("p", { selector: "p" })
    expect(out).toMatch(/"content-type": "application\/json"/)
  })
})

describe("selectorFromSlug", () => {
  it("camel-cases the slug and starts with a letter", () => {
    expect(selectorFromSlug("acme-payments")).toBe("acmePayments")
    expect(selectorFromSlug("petstore")).toBe("petstore")
    expect(selectorFromSlug("3d-api")).toBe("api3dApi")
  })
})
