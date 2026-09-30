import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  importedPackages,
  introspectProviders,
  parseMiddleware,
  parseProvider,
  providersReadByNode,
} from "./introspect-providers.js"

const DB = `import { defineProvider } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import pg from "pg"
import { open } from "./db/open.js"

export default defineProvider({
  name: "Postgres",
  color: "sky",
  uses: ["logger"],
  env: z.object({
    DATABASE_URL: z.string(),
    POOL_SIZE: z.coerce.number().default(10),
    DB_SSL: z.string().optional(),
    DB_NAME: z.string(),
  }),
  create: ({ env }) => open(env.DATABASE_URL),
  dispose: (db) => db.end(),
})
`

describe("parseProvider", () => {
  it("reads lifetime, deps, env status, dispose and packages", () => {
    expect(parseProvider(DB, "providers/db.ts", { DB_NAME: "pets" })).toEqual({
      label: "Postgres",
      color: "sky",
      lifetime: "singleton",
      uses: ["logger"],
      env: [
        { key: "DATABASE_URL", status: "missing" },
        { key: "POOL_SIZE", status: "default" },
        { key: "DB_SSL", status: "optional" },
        { key: "DB_NAME", status: "set" },
      ],
      hasDispose: true,
      packages: ["pg"],
    })
  })

  it("reads a scoped provider written with a method", () => {
    const src = `export default defineProvider({ lifetime: "scoped", create({ request }) { return request } })`
    expect(parseProvider(src, "providers/log.ts")).toMatchObject({
      lifetime: "scoped",
      uses: [],
      env: [],
      hasDispose: false,
    })
  })
})

describe("providersReadByNode", () => {
  const known = new Set(["db", "logger", "clock"])

  it("reads destructured providers, renamed or not", () => {
    const src = `export default defineNode({ async run(input, { db, logger: log }) { return {} } })`
    expect(providersReadByNode(src, known)).toEqual(["db", "logger"])
  })

  it("reads member access and later destructuring on the parameter", () => {
    const src = `export default defineNode({
      run: async (input, providers) => {
        const { clock } = providers
        return providers.db.get(clock.now())
      },
    })`
    expect(providersReadByNode(src, known)).toEqual(["clock", "db"])
  })

  it("ignores names that are not providers and nodes without a second parameter", () => {
    expect(
      providersReadByNode(`export default defineNode({ run(i, { other }) {} })`, known),
    ).toEqual([])
    expect(providersReadByNode(`export default defineNode({ run(i) {} })`, known)).toEqual([])
  })
})

describe("importedPackages", () => {
  it("keeps bare packages, drops relative, node: and lorien imports", () => {
    const src = `import a from "pg"
import { b } from "@aws-sdk/client-s3/dist"
import c from "./c.js"
import d from "node:fs"
import { defineProvider } from "@darrylondil/lorien-runtime"`
    expect(importedPackages(src)).toEqual(["@aws-sdk/client-s3", "pg"])
  })
})

describe("introspectProviders", () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("joins providers with the nodes that read them and their private folders", async () => {
    dir = mkdtempSync(join(tmpdir(), "lorien-introspect-providers-"))
    mkdirSync(join(dir, "providers", "db"), { recursive: true })
    mkdirSync(join(dir, "nodes", "pets"), { recursive: true })
    writeFileSync(join(dir, "providers", "db.ts"), DB)
    writeFileSync(
      join(dir, "providers", "db", "open.ts"),
      `import Database from "better-sqlite3"\n`,
    )
    writeFileSync(
      join(dir, "providers", "logger.ts"),
      `export default defineProvider({ lifetime: "scoped", create: () => console })\n`,
    )
    writeFileSync(
      join(dir, "nodes", "pets", "add-pet.ts"),
      `export default defineNode({ run: async (input, { db, logger }) => ({}) })\n`,
    )
    writeFileSync(
      join(dir, "nodes", "hello.ts"),
      `export default defineNode({ run: async () => ({}) })\n`,
    )

    const result = await introspectProviders(dir, {})
    expect(result.nodes).toEqual({ "./nodes/hello": [], "./nodes/pets/add-pet": ["db", "logger"] })
    expect(result.providers.map((p) => [p.name, p.lifetime, p.packages, p.usedBy])).toEqual([
      ["db", "singleton", ["better-sqlite3", "pg"], ["nodes/pets/add-pet.ts"]],
      ["logger", "scoped", [], ["nodes/pets/add-pet.ts"]],
    ])
  })

  it("returns nothing for a project without providers", async () => {
    dir = mkdtempSync(join(tmpdir(), "lorien-introspect-providers-"))
    expect(await introspectProviders(dir, {})).toEqual({ providers: [], middleware: [], nodes: {} })
  })
})

describe("parseMiddleware", () => {
  const known = new Set(["logger", "db"])

  it("reads a single middleware's name and the providers it reads", () => {
    const src = `export default defineMiddleware({
      name: "Request log",
      async run(c, next, { logger }) { await next() },
    })`
    expect(parseMiddleware(src, known)).toEqual({ names: ["Request log"], reads: ["logger"] })
  })

  it("reads an array in run order, unnamed entries as null", () => {
    const src = `export default [
      defineMiddleware({ name: "CORS", run: (c, next) => next() }),
      defineMiddleware({ run: (c, next, providers) => providers.db && next() }),
    ]`
    expect(parseMiddleware(src, known)).toEqual({ names: ["CORS", null], reads: ["db"] })
  })
})
