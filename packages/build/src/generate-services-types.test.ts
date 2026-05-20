import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generateServicesTypes, renderServicesDts } from "./generate-services-types.js"

describe("renderServicesDts", () => {
  it("renders empty services interface when no services", () => {
    const out = renderServicesDts([])
    expect(out).toMatch(/declare module "@cozy\/runtime"/)
    expect(out).toMatch(/interface Services \{/)
    expect(out).toMatch(/export \{\}/)
  })

  it("renders each service name typed as unknown", () => {
    const out = renderServicesDts(["db", "logger"])
    expect(out).toMatch(/db: unknown/)
    expect(out).toMatch(/logger: unknown/)
  })
})

describe("generateServicesTypes (fixture-based)", () => {
  // Use the runtime's fixture which has a cozy.config.ts exporting `db`
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

  it("generates services.d.ts from the runtime fixture", async () => {
    const result = await generateServicesTypes(runtimeFixture)
    expect(result.path).not.toBeNull()
    expect(result.path).toContain("services.d.ts")
    expect(result.serviceNames).toContain("db")
    const content = readFileSync(result.path!, "utf-8")
    expect(content).toMatch(/db: unknown/)
  })
})

describe("generateServicesTypes (no config)", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cozy-types-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("returns null path when no cozy.config.ts exists", async () => {
    const result = await generateServicesTypes(dir)
    expect(result.path).toBeNull()
    expect(result.serviceNames).toEqual([])
  })
})
