import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { extractSchemas } from "./extract-schemas.js"

// Use the runtime's own fixture for the basic test
const __dirname = dirname(fileURLToPath(import.meta.url))
const runtimeFixture = join(
  __dirname,
  "..",
  "..",
  "runtime",
  "src",
  "dev-server",
  "__fixtures__",
  "basic",
)

describe("extractSchemas", () => {
  it("returns schemas for nodes discovered under <root>/nodes/", async () => {
    const result = await extractSchemas(runtimeFixture)
    expect(result.errors).toEqual([])
    expect(result.schemas.length).toBeGreaterThan(0)
    const sayHello = result.schemas.find((s) => s.uses === "./nodes/say-hello")
    expect(sayHello).toBeDefined()
    expect(sayHello?.kind).toBe("node")
    expect(sayHello?.outputs).toBeDefined()
  })

  it("returns empty schemas for a directory with no nodes/", async () => {
    const tmp = join(__dirname, "..", "test-empty") // doesn't exist; importNodes returns empty
    const result = await extractSchemas(tmp)
    expect(result.schemas).toEqual([])
  })
})
