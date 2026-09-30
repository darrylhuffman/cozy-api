import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createProviderContainer } from "./container.js"
import { defineProvider, selectorProblem } from "./define-provider.js"
import { scanProviderFiles } from "./load.js"
import { planProviders } from "./plan.js"

const request = { requestId: "r1", timestamp: 0 }

describe("defineProvider", () => {
  it("defaults to a singleton with no deps", () => {
    const p = defineProvider({ selector: "p", create: () => 1 })
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
      single: defineProvider({ selector: "single", create: () => ({ n: ++counts.single }) }),
      scoped: defineProvider({
        selector: "scoped",
        lifetime: "scoped",
        create: ({ request }) => ({ n: ++counts.scoped, id: request?.requestId }),
      }),
      transient: defineProvider({
        selector: "transient",
        lifetime: "transient",
        create: () => ++counts.transient,
      }),
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
          selector: "url",
          env: z.object({ DB_URL: z.string(), POOL: z.coerce.number().default(4) }),
          create: ({ env }) => `${env.DB_URL}?pool=${env.POOL}`,
        }),
        client: defineProvider({
          selector: "client",
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
        db: defineProvider({
          selector: "db",
          env: z.object({ DATABASE_URL: z.string() }),
          create: () => 1,
        }),
      },
      { env: {} },
    )
    await expect(container.init()).rejects.toThrow(/db: DATABASE_URL/)
  })

  it("disposes scoped values per request and singletons on dispose, newest first", async () => {
    const disposed: string[] = []
    const container = createProviderContainer({
      a: defineProvider({
        selector: "a",
        create: () => "a",
        dispose: (v) => void disposed.push(v),
      }),
      b: defineProvider({
        selector: "b",
        uses: ["a"],
        create: () => "b",
        dispose: (v) => void disposed.push(v),
      }),
      s: defineProvider({
        selector: "s",
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
      { db: defineProvider({ selector: "db", create }) },
      { overrides: { db: "fake" } },
    )
    const scope = await container.open(request)
    expect(scope.values.db).toBe("fake")
    expect(create).not.toHaveBeenCalled()
  })

  it("rejects a transient provider that creates asynchronously", async () => {
    const container = createProviderContainer({
      t: defineProvider({ selector: "t", lifetime: "transient", create: async () => 1 }),
    })
    const scope = await container.open(request)
    expect(() => scope.values.t).toThrow(/must create its value synchronously/)
  })
})

describe("scanProviderFiles", () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const provider = (selector: string) =>
    `import { defineProvider } from "@darrylondil/lorien-runtime"\nexport default defineProvider({ selector: "${selector}", create: () => 1 })\n`

  it("finds providers in any folder by their selector, skipping helpers and tests", async () => {
    dir = mkdtempSync(join(tmpdir(), "lorien-providers-"))
    mkdirSync(join(dir, "providers", "db"), { recursive: true })
    mkdirSync(join(dir, "providers", "aws"), { recursive: true })
    const files: Record<string, string> = {
      "db.ts": provider("db"),
      "db/open.ts": "export function open() {}\n",
      "aws/s3.ts": provider("s3-bucket"),
      "db.test.ts": provider("db"),
      "types.d.ts": "export {}\n",
    }
    for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, "providers", f), text)
    expect(await scanProviderFiles(dir)).toEqual({
      files: [
        { name: "s3-bucket", path: "providers/aws/s3.ts" },
        { name: "db", path: "providers/db.ts" },
      ],
      errors: [],
    })
  })

  it("reports a missing, invalid or duplicate selector", async () => {
    dir = mkdtempSync(join(tmpdir(), "lorien-providers-"))
    mkdirSync(join(dir, "providers"), { recursive: true })
    writeFileSync(join(dir, "providers", "a.ts"), provider("db"))
    writeFileSync(join(dir, "providers", "b.ts"), provider("db"))
    writeFileSync(join(dir, "providers", "c.ts"), provider("my db"))
    writeFileSync(
      join(dir, "providers", "d.ts"),
      "import { defineProvider } from 'x'\nexport default defineProvider({ create: () => 1 })\n",
    )
    const { files, errors } = await scanProviderFiles(dir)
    expect(files).toEqual([{ name: "db", path: "providers/a.ts" }])
    expect(errors.map((e) => `${e.path}: ${e.message}`)).toEqual([
      'providers/b.ts: selector "db" is already used by providers/a.ts',
      expect.stringContaining('providers/c.ts: selector "my db" must start with a letter'),
      expect.stringContaining("providers/d.ts: defineProvider needs a selector"),
    ])
  })
})

describe("selectorProblem", () => {
  it("allows camelCase, PascalCase, snake_case and dashes", () => {
    for (const s of ["db", "PetStore", "rate_limiter", "http-client", "s3"]) {
      expect(selectorProblem(s)).toBeNull()
    }
  })

  it("refuses empty, badly formed and reserved selectors", () => {
    for (const s of [
      "",
      "1db",
      "_db",
      "my db",
      "db.users",
      "a".repeat(65),
      "constructor",
      "then",
    ]) {
      expect(selectorProblem(s)).not.toBeNull()
    }
    expect(() => defineProvider({ selector: "", create: () => 1 })).toThrow(/selector is required/)
  })
})
