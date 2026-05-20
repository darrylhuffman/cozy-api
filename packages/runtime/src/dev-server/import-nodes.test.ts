import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { importNodes } from "./import-nodes.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtureRoot = join(__dirname, "__fixtures__", "basic")

describe("importNodes (fixture-based)", () => {
  it("discovers and imports nodes from the basic fixture", async () => {
    const result = await importNodes(fixtureRoot)
    expect(result.errors).toEqual([])
    expect(result.nodes["./nodes/say-hello"]).toBeDefined()
    expect(result.nodes["./nodes/say-hello"]?.kind).toBe("node")
  })
})

describe("importNodes (tmp-dir edge cases)", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cozy-import-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns empty results when nodes/ is absent", async () => {
    const result = await importNodes(dir)
    expect(result.nodes).toEqual({})
    expect(result.errors).toEqual([])
  })

  it("ignores .test.ts files", async () => {
    mkdirSync(join(dir, "nodes"))
    // Need to write a syntactically valid but non-node default export
    writeFileSync(join(dir, "nodes", "foo.test.ts"), "export default { kind: 'node' }")
    const result = await importNodes(dir)
    expect(result.nodes).toEqual({})
    expect(result.errors).toEqual([])
  })

  it("reports an error when a file has no default export", async () => {
    mkdirSync(join(dir, "nodes"))
    writeFileSync(join(dir, "nodes", "broken.ts"), "export const notDefault = 1")
    const result = await importNodes(dir)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toMatch(/no default export/i)
  })

  it("reports an error when default export lacks 'kind'", async () => {
    mkdirSync(join(dir, "nodes"))
    writeFileSync(join(dir, "nodes", "wrong.ts"), "export default { hello: 'world' }")
    const result = await importNodes(dir)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toMatch(/Node or Trigger/i)
  })
})
