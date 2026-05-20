import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { GeneratedFile } from "./convert.js"
import { writeGeneratedFiles } from "./write-files.js"

describe("writeGeneratedFiles", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cozy-write-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const operationFile: GeneratedFile = {
    relativePath: "get-pet.ts",
    source: "// cozy-openapi: generated from operation `getPet`.\nexport default {}\n",
  }
  const clientFile: GeneratedFile = {
    relativePath: "_client.ts",
    source: "// cozy-openapi: generated _client helper.\nexport function baseUrl() { return '' }\n",
  }

  it("writes files when they don't exist", async () => {
    const result = await writeGeneratedFiles([operationFile, clientFile], dir, { quiet: true })
    expect(result.written).toEqual(["get-pet.ts", "_client.ts"])
    expect(result.preserved).toEqual([])
    expect(readFileSync(join(dir, "get-pet.ts"), "utf-8")).toContain("cozy-openapi: generated")
  })

  it("overwrites generated files (have marker) on re-import", async () => {
    writeFileSync(
      join(dir, "get-pet.ts"),
      "// cozy-openapi: generated from earlier\n// outdated content\n",
    )
    const result = await writeGeneratedFiles([operationFile], dir, { quiet: true })
    expect(result.written).toEqual(["get-pet.ts"])
    expect(readFileSync(join(dir, "get-pet.ts"), "utf-8")).toBe(operationFile.source)
  })

  it("preserves files without the marker (user-authored)", async () => {
    writeFileSync(join(dir, "get-pet.ts"), "// hand-written by the user\nexport default 42\n")
    const result = await writeGeneratedFiles([operationFile], dir, { quiet: true })
    expect(result.preserved).toEqual(["get-pet.ts"])
    expect(result.written).toEqual([])
    expect(readFileSync(join(dir, "get-pet.ts"), "utf-8")).toContain("hand-written")
  })

  it("--force overwrites everything", async () => {
    writeFileSync(join(dir, "get-pet.ts"), "// hand-written\n")
    writeFileSync(join(dir, "_client.ts"), "// custom client\n")
    const result = await writeGeneratedFiles([operationFile, clientFile], dir, {
      force: true,
      quiet: true,
    })
    expect(result.written).toEqual(["get-pet.ts", "_client.ts"])
    expect(result.preserved).toEqual([])
  })

  it("preserves _client.ts on re-import regardless of marker", async () => {
    writeFileSync(join(dir, "_client.ts"), "// user customized\n")
    const result = await writeGeneratedFiles([clientFile], dir, { quiet: true })
    expect(result.preserved).toEqual(["_client.ts"])
    expect(readFileSync(join(dir, "_client.ts"), "utf-8")).toContain("user customized")
  })

  it("creates parent directories as needed", async () => {
    const nestedDir = join(dir, "deep", "nested")
    const result = await writeGeneratedFiles([operationFile], nestedDir, { quiet: true })
    expect(result.written).toEqual(["get-pet.ts"])
    expect(readFileSync(join(nestedDir, "get-pet.ts"), "utf-8")).toContain("cozy-openapi")
  })
})
