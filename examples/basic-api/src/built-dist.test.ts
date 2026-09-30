import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runBuild } from "@darrylondil/lorien-build/run-build"
import { Hono } from "hono"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")
const distDir = join(root, "dist-built-test")

beforeAll(async () => {
  await runBuild({ root, outDir: distDir, skipTypes: true })
}, 30000)

afterAll(async () => {
  await rm(distDir, { recursive: true, force: true })
})

describe("built dist via lorien build", () => {
  it("compiles a runnable dist/index.js", () => {
    expect(existsSync(join(distDir, "index.js"))).toBe(true)
  })

  it("the built handler serves POST /pets", async () => {
    // Dynamic-import the generated handler (vitest resolves .ts via Vite)
    const generated = (await import(
      pathToFileURL(join(distDir, "workflows", "pets", "add.gen.ts")).href
    )) as {
      register: (app: Hono) => void
    }
    const app = new Hono()
    generated.register(app)

    const res = await app.request("/pets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Nori", species: "cat" }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: number; name: string }
    expect(body.name).toBe("Nori")
    expect(typeof body.id).toBe("number")
  })

  it("runs workflows/_middleware.ts before the route", async () => {
    const generated = (await import(
      pathToFileURL(join(distDir, "workflows", "pets", "list.gen.ts")).href
    )) as { register: (app: Hono) => void }
    const app = new Hono()
    generated.register(app)
    const res = await app.request("/pets")
    expect(res.status).toBe(200)
    expect(res.headers.get("x-response-time")).toMatch(/^\d+ms$/)
  })

  it("exports each route's logic as a run function that needs no Hono", async () => {
    const generated = (await import(
      pathToFileURL(join(distDir, "workflows", "pets", "get.gen.ts")).href
    )) as {
      run_Request: (
        trigger: unknown,
        services: unknown,
      ) => Promise<{ status: number; headers: Record<string, string>; body: unknown }>
    }
    const { openScope } = (await import(pathToFileURL(join(distDir, "providers.gen.ts")).href)) as {
      openScope: (r: unknown) => Promise<{ values: unknown; dispose(): Promise<void> }>
    }
    const context = { requestId: "direct", timestamp: Date.now() }
    const scope = await openScope(context)
    try {
      const result = await generated.run_Request(
        { body: null, params: { id: "99999" }, query: {}, headers: {}, context },
        scope.values,
      )
      expect(result.status).toBe(404)
    } finally {
      await scope.dispose()
    }
  })
})
