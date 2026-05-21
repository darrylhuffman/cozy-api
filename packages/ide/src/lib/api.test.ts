import { describe, expect, it, vi, beforeEach } from "vitest"

describe("api URL helpers", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it("restBase() defaults to http://localhost:3000", async () => {
    const { restBase } = await import("./api.js")
    // In Node/test env there's no Vite env var by default
    expect(restBase()).toBe("http://localhost:3000")
  })

  it("wsUrl() converts http to ws and appends the broker path", async () => {
    const { wsUrl } = await import("./api.js")
    expect(wsUrl()).toBe("ws://localhost:3000/__lorien/agents/ws")
  })

  it("wsUrl() converts https to wss", async () => {
    vi.stubEnv("VITE_LORIEN_API_URL", "https://api.example.com")
    const { wsUrl } = await import("./api.js")
    expect(wsUrl()).toBe("wss://api.example.com/__lorien/agents/ws")
  })

  it("restBase() respects VITE_LORIEN_API_URL", async () => {
    vi.stubEnv("VITE_LORIEN_API_URL", "http://10.0.0.5:8080")
    const { restBase } = await import("./api.js")
    expect(restBase()).toBe("http://10.0.0.5:8080")
  })

  it("wsUrl() strips a trailing slash on the base so the path has no double-slash", async () => {
    vi.stubEnv("VITE_LORIEN_API_URL", "http://10.0.0.5:8080/")
    const { wsUrl } = await import("./api.js")
    expect(wsUrl()).toBe("ws://10.0.0.5:8080/__lorien/agents/ws")
  })
})
