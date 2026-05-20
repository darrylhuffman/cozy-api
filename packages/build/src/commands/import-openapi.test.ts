import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runImportOpenapi } from "./import-openapi.js"

describe("runImportOpenapi (integration)", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cozy-import-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("loads spec, converts, writes per-operation nodes + _client.ts", async () => {
    const specPath = join(dir, "petstore.json")
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Petstore", version: "1.0" },
        paths: {
          "/pets/{petId}": {
            get: {
              operationId: "getPetById",
              parameters: [
                { name: "petId", in: "path", required: true, schema: { type: "string" } },
              ],
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
    )

    const outDir = join(dir, "out")
    const result = await runImportOpenapi(specPath, { out: outDir })

    expect(result.apiSlug).toBe("petstore")
    expect(result.written).toContain("get-pet-by-id.ts")
    expect(result.written).toContain("_client.ts")
    expect(result.errors).toEqual([])
    const opFile = readFileSync(join(outDir, "get-pet-by-id.ts"), "utf-8")
    expect(opFile).toMatch(/defineNode/)
    expect(opFile).toMatch(/cozy-openapi/)
  })

  it("preserves user-modified per-operation files on re-import (no --force)", async () => {
    const specPath = join(dir, "spec.json")
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "x", version: "1" },
        paths: {
          "/things": {
            get: {
              operationId: "listThings",
              responses: { "200": { description: "ok" } },
            },
          },
        },
      }),
    )

    const outDir = join(dir, "out")
    // First import
    await runImportOpenapi(specPath, { out: outDir })

    // User edits the file, removes the marker
    const opPath = join(outDir, "list-things.ts")
    writeFileSync(opPath, "// my custom version\nexport default 'edited'\n")

    // Re-import without --force
    const result = await runImportOpenapi(specPath, { out: outDir })
    expect(result.preserved).toContain("list-things.ts")
    expect(readFileSync(opPath, "utf-8")).toContain("my custom version")
  })

  it("--force overwrites even user-modified files", async () => {
    const specPath = join(dir, "spec.json")
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "x", version: "1" },
        paths: {
          "/y": { get: { operationId: "y", responses: { "200": { description: "ok" } } } },
        },
      }),
    )

    const outDir = join(dir, "out")
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, "y.ts"), "// user-authored, no marker\n")

    const result = await runImportOpenapi(specPath, { out: outDir, force: true })
    expect(result.written).toContain("y.ts")
    expect(readFileSync(join(outDir, "y.ts"), "utf-8")).toMatch(/cozy-openapi/)
  })
})
