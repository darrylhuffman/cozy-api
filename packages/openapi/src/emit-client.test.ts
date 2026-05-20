import { describe, expect, it } from "vitest"
import { emitClientHelper } from "./emit-client.js"

describe("emitClientHelper", () => {
  it("emits baseUrl using an env var derived from the api slug", () => {
    const out = emitClientHelper("petstore", "https://petstore.example.com")
    expect(out).toMatch(/process\.env\.PETSTORE_BASE_URL/)
    expect(out).toMatch(/https:\/\/petstore\.example\.com/)
  })

  it("handles hyphenated slug by converting to underscore env var", () => {
    const out = emitClientHelper("foo-bar", undefined)
    expect(out).toMatch(/process\.env\.FOO_BAR_BASE_URL/)
  })

  it("includes content-type in buildHeaders", () => {
    const out = emitClientHelper("p", "u")
    expect(out).toMatch(/"content-type": "application\/json"/)
  })
})
