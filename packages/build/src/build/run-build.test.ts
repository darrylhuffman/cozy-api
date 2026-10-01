import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { runBuild } from "./run-build.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
// Use the runtime's fixture (basic-api has too much; runtime fixture is minimal)
const fixtureRoot = join(
  __dirname,
  "..",
  "..",
  "..",
  "runtime",
  "src",
  "dev-server",
  "__fixtures__",
  "basic",
)

describe("runBuild (integration)", () => {
  it("builds the runtime fixture: writes dist/workflows + dist/index.ts", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lorien-build-"))
    try {
      const result = await runBuild({
        root: fixtureRoot,
        outDir: tmp,
        skipTypes: true, // fixture's lorien.config writes to its own .lorien/ — skip in tests
        // The output lives outside the fixture, so its relative imports cannot be bundled.
        bundle: false,
      })
      expect(result.ok).toBe(true)
      expect(result.workflowsBuilt).toBeGreaterThan(0)
      expect(existsSync(join(tmp, "index.ts"))).toBe(true)
      // hello.workflow -> workflows/hello.gen.ts
      expect(existsSync(join(tmp, "workflows", "hello.gen.ts"))).toBe(true)
      const helloGen = readFileSync(join(tmp, "workflows", "hello.gen.ts"), "utf-8")
      expect(helloGen).toMatch(/AUTO-GENERATED/)
      expect(helloGen).toMatch(/export function register/)
      expect(helloGen).toMatch(/say-hello/) // the user node is imported
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("cleans existing outDir before building", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lorien-build-"))
    try {
      // Pre-populate
      const fs = await import("node:fs/promises")
      await fs.writeFile(join(tmp, "STALE_FILE.txt"), "should be removed")

      await runBuild({ root: fixtureRoot, outDir: tmp, skipTypes: true })
      expect(existsSync(join(tmp, "STALE_FILE.txt"))).toBe(false)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("fails on a wire the nodes can't satisfy, naming the node and field", async () => {
    // A sibling of the fixture, so its imports (zod, the runtime) still resolve.
    const project = mkdtempSync(join(fixtureRoot, "..", "wiring-"))
    const out = mkdtempSync(join(tmpdir(), "lorien-build-"))
    try {
      cpSync(fixtureRoot, project, { recursive: true })
      writeFileSync(
        join(project, "workflows", "hello.workflow"),
        JSON.stringify({
          lorien: 1,
          nodes: {
            req: { uses: "@core/http-request", values: { path: "/hello", method: "GET" } },
            say: { uses: "./nodes/say-hello", in: {} },
            res: { uses: "@core/http-response", in: { body: "say.greting" } },
          },
        }),
      )
      const result = await runBuild({ root: project, outDir: out, skipTypes: true, bundle: false })
      expect(result.ok).toBe(false)
      expect(result.errors).toContainEqual({
        workflow: "workflows/hello.workflow",
        message: expect.stringMatching(/^res\.in\.body: `say\.greting` reads output `greting`/),
      })
    } finally {
      rmSync(project, { recursive: true, force: true })
      rmSync(out, { recursive: true, force: true })
    }
  })

  it("with typecheck, stops at a type error before generating anything", async () => {
    const project = mkdtempSync(join(tmpdir(), "lorien-tsc-"))
    const out = join(project, "dist")
    try {
      writeFileSync(
        join(project, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["x.ts"] }),
      )
      writeFileSync(join(project, "x.ts"), 'export const n: number = "x"\n')
      const result = await runBuild({
        root: project,
        outDir: out,
        skipTypes: true,
        typecheck: true,
      })
      expect(result.ok).toBe(false)
      expect(result.errors).toEqual([{ workflow: "tsc", message: "tsc --noEmit exited with 2" }])
      expect(existsSync(join(out, "index.ts"))).toBe(false)
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  })
})
