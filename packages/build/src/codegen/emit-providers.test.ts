import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { type EmitProviderInfo, emitProviders } from "./emit-providers.js"

const info = (p: Partial<EmitProviderInfo> & { name: string }): EmitProviderInfo => ({
  path: `providers/${p.name}.ts`,
  lifetime: "singleton",
  uses: [],
  hasEnv: false,
  hasDispose: false,
  ...p,
})

describe("emitProviders — source", () => {
  it("emits only static imports and singletons when nothing is per request", () => {
    const { source, perRequest } = emitProviders({ providers: [info({ name: "db" })] })
    expect(perRequest).toBe(false)
    expect(source).toContain(`import provider_db from "../providers/db.js"`)
    expect(source).toMatch(/singletons\["db"\] = await/)
    expect(source).not.toMatch(/openScope|lorien-runtime|lorien\.config/)
  })

  it("emits openScope when a provider is scoped or a legacy service is a factory", () => {
    expect(
      emitProviders({ providers: [info({ name: "log", lifetime: "scoped" })] }).perRequest,
    ).toBe(true)
    const legacy = emitProviders({ providers: [], legacy: { values: [], factories: ["log"] } })
    expect(legacy.perRequest).toBe(true)
    expect(legacy.source).toContain(`import config from "../lorien.config.js"`)
  })
})

describe("emitProviders — generated module", () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const provider = (body: string) => `export default { kind: "provider", ${body} }\n`

  it("wires lifetimes, deps, env and dispose the way the dev container does", async () => {
    dir = mkdtempSync(join(tmpdir(), "lorien-emit-providers-"))
    mkdirSync(join(dir, "providers"))
    mkdirSync(join(dir, "dist"))
    const w = (name: string, body: string) =>
      writeFileSync(join(dir, "providers", `${name}.js`), provider(body))
    w(
      "url",
      `lifetime: "singleton", uses: [],
       env: { safeParse: (e) => ({ success: true, data: { URL: e.EMIT_TEST_URL ?? "mem" } }) },
       create: ({ env }) => env.URL`,
    )
    w(
      "db",
      `lifetime: "singleton", uses: ["url"],
       create: ({ providers }) => ({ url: providers.url, closed: false }),
       dispose: (db) => { db.closed = true }`,
    )
    w(
      "log",
      `lifetime: "scoped", uses: ["db"],
       create: ({ request, providers }) => ({ id: request.requestId, db: providers.db }),
       dispose: (log) => { log.disposed = true }`,
    )
    w("clock", `lifetime: "transient", uses: [], create: () => ({})`)
    writeFileSync(
      join(dir, "lorien.config.js"),
      `export default { services: { flag: true, perReq: (r) => r.requestId } }\n`,
    )

    const { source } = emitProviders({
      providers: [
        info({ name: "url", path: "providers/url.js", hasEnv: true }),
        info({ name: "db", path: "providers/db.js", uses: ["url"], hasDispose: true }),
        info({
          name: "log",
          path: "providers/log.js",
          lifetime: "scoped",
          uses: ["db"],
          hasDispose: true,
        }),
        info({ name: "clock", path: "providers/clock.js", lifetime: "transient" }),
      ],
      legacy: { values: ["flag"], factories: ["perReq"] },
    })
    writeFileSync(join(dir, "dist", "providers.gen.ts"), source)
    const gen = await import(pathToFileURL(join(dir, "dist", "providers.gen.ts")).href)

    expect(gen.singletons).toMatchObject({ url: "mem", db: { url: "mem" }, flag: true })
    const scope = await gen.openScope({ requestId: "r1", timestamp: 0 })
    expect(scope.values.log).toMatchObject({ id: "r1", db: gen.singletons.db })
    expect(scope.values.perReq).toBe("r1")
    expect(scope.values.clock).not.toBe(scope.values.clock)
    await scope.dispose()
    expect(scope.values.log.disposed).toBe(true)
    await gen.disposeSingletons()
    expect(gen.singletons.db.closed).toBe(true)
  })
})
