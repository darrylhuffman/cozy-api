import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { debugWsUrl } from "./api"

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

describe("debugWsUrl", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("derives ws://host:port/__lorien/debug/ws from the default REST base", () => {
    expect(debugWsUrl()).toBe("ws://localhost:3000/__lorien/debug/ws")
  })

  it("uses wss for https REST base", () => {
    vi.stubEnv("VITE_LORIEN_API_URL", "https://api.example.com")
    expect(debugWsUrl()).toBe("wss://api.example.com/__lorien/debug/ws")
  })
})

describe("resolveRestBase", () => {
  it("uses the page's own origin in a production bundle served by `lorien ide`", async () => {
    const { resolveRestBase } = await import("./api.js")
    expect(resolveRestBase({ devServer: false, pageOrigin: "http://localhost:8188" })).toBe(
      "http://localhost:8188",
    )
  })

  it("keeps the localhost:3000 default on the Vite dev server", async () => {
    const { resolveRestBase } = await import("./api.js")
    expect(resolveRestBase({ devServer: true, pageOrigin: "http://localhost:5173" })).toBe(
      "http://localhost:3000",
    )
  })

  it("an explicit VITE_LORIEN_API_URL always wins", async () => {
    const { resolveRestBase } = await import("./api.js")
    expect(
      resolveRestBase({
        configuredUrl: "http://10.0.0.5:8080",
        devServer: false,
        pageOrigin: "http://localhost:8188",
      }),
    ).toBe("http://10.0.0.5:8080")
  })
})

describe("workspace API errors", () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it("surfaces the server's { error } message with its status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Only .workflow and .ts files may be written" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    )
    const { saveFile, ApiError } = await import("./api.js")
    const err = await saveFile("x.txt", "hi").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as InstanceType<typeof ApiError>).status).toBe(400)
    expect((err as Error).message).toBe("Only .workflow and .ts files may be written")
  })

  it("falls back to a descriptive message when the body is not JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }))
    const { fetchWorkspaceTree } = await import("./api.js")
    await expect(fetchWorkspaceTree()).rejects.toThrow("Loading the file tree failed (HTTP 502)")
  })

  it("explains network failures instead of a bare TypeError", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    const { fetchFile } = await import("./api.js")
    const err = await fetchFile("workflows/a.workflow").catch((e: unknown) => e)
    expect((err as Error).message).toMatch(/could not reach the lorien IDE server/)
    expect((err as { status: number }).status).toBe(0)
  })

  it("createWorkspaceFile reports an existing file as a 409", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 409 }))
    const { createWorkspaceFile } = await import("./api.js")
    await expect(createWorkspaceFile("nodes/a.ts", "")).rejects.toThrow("File already exists")
  })
})

describe("parseWorkflowContent", () => {
  it("parses a valid workflow", async () => {
    const { parseWorkflowContent } = await import("./api.js")
    const wf = parseWorkflowContent("w.workflow", '{"lorien":1,"nodes":{"a":{"uses":"./a"}}}')
    expect(wf.nodes.a?.uses).toBe("./a")
  })

  it.each([
    ["{nope", /w\.workflow is not valid JSON/],
    ["[]", /must contain a JSON object/],
    ['{"lorien":1}', /missing its "nodes" object/],
    ['{"lorien":1,"nodes":{"a":{}}}', /node "a" is missing a "uses" string/],
  ])("rejects %s with a readable reason", async (content, reason) => {
    const { parseWorkflowContent } = await import("./api.js")
    expect(() => parseWorkflowContent("w.workflow", content)).toThrow(reason)
  })
})
