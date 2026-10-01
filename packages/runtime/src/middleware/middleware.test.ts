import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import type { LoadedWorkflow } from "../dev-server/load.js"
import { mountWorkflows } from "../dev-server/server.js"
import { createProviderContainer } from "../providers/container.js"
import { defineProvider } from "../providers/define-provider.js"
import type { Services } from "../types.js"
import { parseWorkflow } from "../workflow/parse.js"
import { defineMiddleware, isMiddleware } from "./define-middleware.js"
import { findMiddlewareFiles, importMiddleware, middlewareChain } from "./load.js"

const route = (relativePath: string, path: string): LoadedWorkflow => ({
  absolutePath: `/fake/${relativePath}`,
  relativePath,
  file: parseWorkflow({
    lorien: 1,
    nodes: {
      req: { uses: "@core/http-request", values: { path, method: "GET" } },
      read: { uses: "./read" },
      res: { uses: "@core/http-response", in: { body: "read.seen" } },
    },
  }),
})

/** Returns what the request log looked like when the workflow ran. */
const read = defineNode({
  inputs: z.object({}),
  outputs: z.object({ seen: z.array(z.string()) }),
  async run(_input, providers) {
    const log = (providers as unknown as { log: string[] }).log
    return { seen: [...log] }
  },
})

describe("defineMiddleware", () => {
  it("marks middleware so the loader can recognise it", () => {
    const mw = defineMiddleware({ run: (_c, next) => next() })
    expect(mw.kind).toBe("middleware")
    expect(isMiddleware(mw)).toBe(true)
    expect(isMiddleware({ kind: "node" })).toBe(false)
  })
})

describe("middlewareChain", () => {
  const files = [{ dir: "workflows/admin" }, { dir: "workflows" }, { dir: "workflows/pets" }]

  it("picks the workflow's folder and its parents, outermost first", () => {
    expect(middlewareChain("workflows/admin/users/list.workflow", files)).toEqual([
      { dir: "workflows" },
      { dir: "workflows/admin" },
    ])
    expect(middlewareChain("workflows/hello.workflow", files)).toEqual([{ dir: "workflows" }])
  })

  it("does not match a folder that only shares a prefix", () => {
    expect(middlewareChain("workflows/administrators/x.workflow", files)).toEqual([
      { dir: "workflows" },
    ])
  })
})

describe("mountWorkflows with middleware", () => {
  const logMw = (name: string) =>
    defineMiddleware({
      async run(c, next, providers) {
        ;(providers as unknown as { log: string[] }).log.push(name)
        await next()
        c.res.headers.append("x-after", name)
      },
    })

  function mount(middleware: Record<string, ReturnType<typeof defineMiddleware>[]>) {
    const container = createProviderContainer({
      log: defineProvider({ selector: "log", lifetime: "scoped", create: (): string[] => [] }),
    })
    const app = new Hono()
    mountWorkflows(
      app,
      [
        route("workflows/admin/stats.workflow", "/admin/stats"),
        route("workflows/open.workflow", "/open"),
      ],
      { nodes: { "./read": read }, providers: container, middleware },
    )
    return app
  }

  it("runs a route's folder middleware outermost first, sharing one provider scope", async () => {
    const app = mount({
      workflows: [logMw("root")],
      "workflows/admin": [logMw("admin-1"), logMw("admin-2")],
    })
    const res = await app.request("/admin/stats")
    expect(await res.json()).toEqual(["root", "admin-1", "admin-2"])
    // Code after next() sees the response, innermost first.
    expect(res.headers.get("x-after")).toBe("admin-2, admin-1, root")

    expect(await (await app.request("/open")).json()).toEqual(["root"])
  })

  it("keeps headers middleware sets before next()", async () => {
    const app = mount({
      workflows: [
        defineMiddleware({
          async run(c, next) {
            c.header("access-control-allow-origin", "*")
            await next()
          },
        }),
      ],
    })
    const res = await app.request("/open")
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
    expect(res.headers.get("content-type")).toBe("application/json")
  })

  it("lets middleware answer early without running the workflow", async () => {
    const app = mount({
      "workflows/admin": [
        defineMiddleware({
          run: (c) => c.json({ error: "forbidden" }, 403),
        }),
      ],
    })
    const res = await app.request("/admin/stats")
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: "forbidden" })
    expect((await app.request("/open")).status).toBe(200)
  })

  it("passes a fixed services bag when there is no provider container", async () => {
    const app = new Hono()
    const services = { log: ["from-services"] } as unknown as Services
    mountWorkflows(app, [route("workflows/open.workflow", "/open")], {
      nodes: { "./read": read },
      services,
      middleware: { workflows: [logMw("root")] },
    })
    expect(await (await app.request("/open")).json()).toEqual(["from-services", "root"])
  })
})

describe("findMiddlewareFiles / importMiddleware", () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("finds _middleware files under workflows/ and imports single or array exports", async () => {
    dir = mkdtempSync(join(tmpdir(), "lorien-middleware-"))
    mkdirSync(join(dir, "workflows", "admin", "deep"), { recursive: true })
    const mw = (name: string) => `{ kind: "middleware", name: "${name}", run: (c, next) => next() }`
    writeFileSync(join(dir, "workflows", "_middleware.mjs"), `export default ${mw("root")}\n`)
    writeFileSync(
      join(dir, "workflows", "admin", "_middleware.mjs"),
      `export default [${mw("a")}, ${mw("b")}]\n`,
    )
    writeFileSync(join(dir, "workflows", "admin", "deep", "_middleware.mjs"), `export default 1\n`)

    expect(await findMiddlewareFiles(dir)).toEqual([
      { dir: "workflows", path: "workflows/_middleware.mjs" },
      { dir: "workflows/admin", path: "workflows/admin/_middleware.mjs" },
      { dir: "workflows/admin/deep", path: "workflows/admin/deep/_middleware.mjs" },
    ])
    const { byDir, errors } = await importMiddleware(dir)
    expect(
      Object.fromEntries(Object.entries(byDir).map(([k, v]) => [k, v.map((m) => m.name)])),
    ).toEqual({
      workflows: ["root"],
      "workflows/admin": ["a", "b"],
    })
    expect(errors).toEqual([
      {
        path: "workflows/admin/deep/_middleware.mjs",
        message: "default export must be defineMiddleware(...) or an array of them",
      },
    ])
  })
})
