import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createProviderContainer } from "./container.js"
import { defineProvider } from "./define-provider.js"
import { findProviderFiles, providerName } from "./load.js"
import { planProviders } from "./plan.js"

const request = { requestId: "r1", timestamp: 0 }

describe("defineProvider", () => {
  it("defaults to a singleton with no deps", () => {
    const p = defineProvider({ create: () => 1 })
    expect(p.kind).toBe("provider")
    expect(p.lifetime).toBe("singleton")
    expect(p.uses).toEqual([])
  })
})

describe("planProviders", () => {
  it("orders providers after the ones they use", () => {
    const plan = planProviders([
      { name: "app", lifetime: "scoped", uses: ["sink", "db"] },
      { name: "sink", lifetime: "singleton", uses: [] },
      { name: "db", lifetime: "singleton", uses: ["sink"] },
    ])
    expect(plan.errors).toEqual([])
    expect(plan.order).toEqual(["sink", "db", "app"])
  })

  it("rejects a singleton that uses a scoped provider", () => {
    const plan = planProviders([
      { name: "cache", lifetime: "singleton", uses: ["log"] },
      { name: "log", lifetime: "scoped", uses: [] },
    ])
    expect(plan.errors[0]).toMatch(/singleton provider "cache" can't use scoped provider "log"/)
  })

  it("reports unknown deps and cycles", () => {
    const plan = planProviders([
      { name: "a", lifetime: "singleton", uses: ["b", "nope"] },
      { name: "b", lifetime: "singleton", uses: ["a"] },
    ])
    expect(plan.errors).toContain(`provider "a" uses unknown provider "nope"`)
    expect(plan.errors.some((e) => e.includes("cycle"))).toBe(true)
  })

  it("lets providers use legacy services", () => {
    expect(
      planProviders([{ name: "a", lifetime: "singleton", uses: ["cfg"] }], ["cfg"]).errors,
    ).toEqual([])
  })
})

describe("createProviderContainer", () => {
  it("creates singletons once, scoped per request, transient per read", async () => {
    const counts = { single: 0, scoped: 0, transient: 0 }
    const container = createProviderContainer({
      single: defineProvider({ create: () => ({ n: ++counts.single }) }),
      scoped: defineProvider({
        lifetime: "scoped",
        create: ({ request }) => ({ n: ++counts.scoped, id: request?.requestId }),
      }),
      transient: defineProvider({ lifetime: "transient", create: () => ++counts.transient }),
    })
    const a = await container.open(request)
    const b = await container.open({ requestId: "r2", timestamp: 0 })
    expect(a.values.single).toBe(b.values.single)
    expect(a.values.scoped).toEqual({ n: 1, id: "r1" })
    expect(b.values.scoped).toEqual({ n: 2, id: "r2" })
    expect(a.values.transient).toBe(1)
    expect(a.values.transient).toBe(2)
    expect(counts.single).toBe(1)
  })

  it("passes a provider the providers it uses and its parsed env", async () => {
    const container = createProviderContainer(
      {
        url: defineProvider({
          env: z.object({ DB_URL: z.string(), POOL: z.coerce.number().default(4) }),
          create: ({ env }) => `${env.DB_URL}?pool=${env.POOL}`,
        }),
        client: defineProvider({
          uses: ["url"],
          create: ({ providers }) => ({ connectedTo: providers.url }),
        }),
      },
      { env: { DB_URL: "sqlite://x" } },
    )
    const scope = await container.open(request)
    expect(scope.values.client).toEqual({ connectedTo: "sqlite://x?pool=4" })
  })

  it("names every missing env var at boot", async () => {
    const container = createProviderContainer(
      {
        db: defineProvider({ env: z.object({ DATABASE_URL: z.string() }), create: () => 1 }),
      },
      { env: {} },
    )
    await expect(container.init()).rejects.toThrow(/db: DATABASE_URL/)
  })

  it("disposes scoped values per request and singletons on dispose, newest first", async () => {
    const disposed: string[] = []
    const container = createProviderContainer({
      a: defineProvider({ create: () => "a", dispose: (v) => void disposed.push(v) }),
      b: defineProvider({ uses: ["a"], create: () => "b", dispose: (v) => void disposed.push(v) }),
      s: defineProvider({
        lifetime: "scoped",
        create: () => "s",
        dispose: (v) => void disposed.push(v),
      }),
    })
    const scope = await container.open(request)
    await scope.dispose()
    expect(disposed).toEqual(["s"])
    await container.dispose()
    expect(disposed).toEqual(["s", "b", "a"])
  })

  it("keeps legacy services working: values shared, factories per request", async () => {
    const factory = vi.fn(() => ({ fresh: true }))
    const container = createProviderContainer({}, { legacy: { config: { x: 1 }, logger: factory } })
    const a = await container.open(request)
    await container.open(request)
    expect(a.values.config).toEqual({ x: 1 })
    expect(a.values.logger).toEqual({ fresh: true })
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it("lets overrides replace providers without creating them", async () => {
    const create = vi.fn(() => "real")
    const container = createProviderContainer(
      { db: defineProvider({ create }) },
      { overrides: { db: "fake" } },
    )
    const scope = await container.open(request)
    expect(scope.values.db).toBe("fake")
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects a transient provider that creates asynchronously", async () => {
    const container = createProviderContainer({
      t: defineProvider({ lifetime: "transient", create: async () => 1 }),
    })
    const scope = await container.open(request)
    expect(() => scope.values.t).toThrow(/must create its value synchronously/)
  })
})

describe("findProviderFiles", () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("lists top-level provider files only, camelCasing their names", async () => {
    dir = mkdtempSync(join(tmpdir(), "lorien-providers-"))
    mkdirSync(join(dir, "providers", "db"), { recursive: true })
    for (const f of ["db.ts", "http-client.ts", "db.test.ts", "types.d.ts", "db/open.ts"]) {
      writeFileSync(join(dir, "providers", f), "export {}\n")
    }
    expect(await findProviderFiles(dir)).toEqual([
      { name: "db", path: "providers/db.ts" },
      { name: "httpClient", path: "providers/http-client.ts" },
    ])
    expect(providerName("rate_limiter")).toBe("rateLimiter")
  })
})
