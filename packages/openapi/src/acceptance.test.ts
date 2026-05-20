import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { convertOpenApiSpec, loadOpenApiSpec, writeGeneratedFiles } from "./index.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturePath = join(__dirname, "..", "test-fixtures", "petstore.json")

// Use a temp dir within the packages/openapi directory so that Vitest's module
// resolver can find @cozy/runtime and zod from the surrounding node_modules when
// dynamically importing generated TypeScript files.
const packageRoot = join(__dirname, "..")

let outDir: string
let tmpProject: string

beforeAll(async () => {
  tmpProject = mkdtempSync(join(packageRoot, "__test_generated_"))
  outDir = join(tmpProject, "nodes", "petstore")

  const spec = await loadOpenApiSpec(fixturePath)
  const result = convertOpenApiSpec(spec, { defaultBaseUrl: "https://petstore.example.com/v3" })
  await writeGeneratedFiles(result.files, outDir, { quiet: true })
})

afterAll(() => {
  if (tmpProject) rmSync(tmpProject, { recursive: true, force: true })
})

describe("Plan #3 acceptance — petstore", () => {
  it("generates the expected files", () => {
    const expected = ["list-pets.ts", "add-pet.ts", "get-pet-by-id.ts", "_client.ts"]
    for (const f of expected) {
      const content = readFileSync(join(outDir, f), "utf-8")
      expect(content.length).toBeGreaterThan(0)
    }
  })

  it("generated operation files contain expected structure", () => {
    const listPets = readFileSync(join(outDir, "list-pets.ts"), "utf-8")
    expect(listPets).toMatch(/cozy-openapi: generated/)
    expect(listPets).toMatch(/import \{ defineNode \} from "@cozy\/runtime"/)
    expect(listPets).toMatch(/export default defineNode/)
    expect(listPets).toMatch(/baseUrl\(\)/)
    expect(listPets).toMatch(/\bfetch\(/)

    const getPet = readFileSync(join(outDir, "get-pet-by-id.ts"), "utf-8")
    expect(getPet).toMatch(/pathParams: z\.object/)
    expect(getPet).toMatch(/"petId": z\.string\(\)/)
    expect(getPet).toMatch(/\$\{pathParams\.petId\}/)
  })

  it("Pet schema's enum is preserved in generated outputs", () => {
    const getPet = readFileSync(join(outDir, "get-pet-by-id.ts"), "utf-8")
    expect(getPet).toMatch(/z\.enum\(\["available", "pending", "sold"\] as const\)/)
  })

  it("_client.ts has the petstore-specific env var and base URL", () => {
    const client = readFileSync(join(outDir, "_client.ts"), "utf-8")
    expect(client).toMatch(/process\.env\.PETSTORE_API_BASE_URL/)
    expect(client).toMatch(/petstore\.example\.com/)
  })

  it("a generated node executes correctly when its fetch is mocked", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, _init: unknown) => {
      return new Response(
        JSON.stringify({
          id: "11111111-1111-1111-1111-111111111111",
          name: "Rex",
          status: "available",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as typeof fetch

    try {
      const moduleUrl = pathToFileURL(join(outDir, "get-pet-by-id.ts")).href
      const mod = (await import(moduleUrl)) as {
        default: { run: (input: unknown) => Promise<unknown> }
      }
      const result = (await mod.default.run({
        pathParams: { petId: "11111111-1111-1111-1111-111111111111" },
      })) as { data: { id: string; name: string; status: string } }

      expect(result.data.id).toBe("11111111-1111-1111-1111-111111111111")
      expect(result.data.name).toBe("Rex")
      expect(result.data.status).toBe("available")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
