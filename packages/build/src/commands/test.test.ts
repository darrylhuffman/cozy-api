import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runTest } from "./test.js"

let dir: string
let lines: string[]
const log = (l: string) => lines.push(l)

function app(status = 201) {
  const a = new Hono()
  a.post("/users", (c) => c.json({ id: "u1" }, status as 201))
  return a
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lorien-test-"))
  lines = []
  mkdirSync(join(dir, "workflows"))
  writeFileSync(
    join(dir, "workflows/create.requests.json"),
    JSON.stringify({
      lorien: 1,
      requests: [
        {
          id: "create",
          name: "creates a user",
          method: "POST",
          path: "/users",
          expect: [{ target: "status", op: "equals", value: 201 }],
        },
      ],
    }),
  )
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe("lorien test", () => {
  it("passes and prints a summary", async () => {
    const r = await runTest(
      { root: dir },
      { startApp: async () => app(), runCases: async () => [], log },
    )
    expect(r).toMatchObject({ exitCode: 0, passed: 1, failed: 0 })
    expect(lines[0]).toBe("workflows/create.requests.json")
    expect(lines[1]).toMatch(/^ {2}✓ creates a user \(\d+ms\)$/)
    expect(lines.at(-1)).toBe("1 passed, 0 failed")
  })

  it("exits 1 and explains failures", async () => {
    const r = await runTest(
      { root: dir },
      { startApp: async () => app(200), runCases: async () => [], log },
    )
    expect(r.exitCode).toBe(1)
    expect(lines).toContain("      expected status equals 201, got 200")
  })

  it("prints JSON with --json", async () => {
    await runTest(
      { root: dir, json: true },
      { startApp: async () => app(), runCases: async () => [], log },
    )
    expect(JSON.parse(lines.join("\n"))).toMatchObject({ passed: 1, failed: 0 })
  })

  it("says how to create requests when there are none", async () => {
    rmSync(join(dir, "workflows/create.requests.json"))
    const r = await runTest(
      { root: dir },
      { startApp: async () => app(), runCases: async () => [], log },
    )
    expect(r.exitCode).toBe(0)
    expect(lines[0]).toMatch(/No tests found/)
  })

  it("reports setup errors instead of throwing", async () => {
    const r = await runTest(
      { root: dir, env: "prod" },
      { startApp: async () => app(), runCases: async () => [], log },
    )
    expect(r.exitCode).toBe(1)
    expect(lines[0]).toMatch(/Unknown environment "prod"/)
  })

  it("runs node cases first and counts them", async () => {
    const r = await runTest(
      { root: dir },
      {
        startApp: async () => app(),
        runCases: async () => [
          {
            path: "nodes/save-user.cases.json",
            uses: "./nodes/save-user",
            results: [
              { caseId: "a", name: "saves", passed: true, failures: [], durationMs: 1 },
              {
                caseId: "b",
                name: "rejects",
                passed: false,
                failures: ["threw: boom"],
                durationMs: 2,
              },
            ],
          },
        ],
        log,
      },
    )
    expect(r).toMatchObject({ exitCode: 1, passed: 2, failed: 1 })
    expect(lines.slice(0, 4)).toEqual([
      "nodes/save-user.cases.json",
      "  ✓ saves (1ms)",
      "  ✗ rejects (2ms)",
      "      threw: boom",
    ])
  })

  it("--no-nodes and --no-requests skip each kind", async () => {
    let casesRan = false
    const r = await runTest(
      { root: dir, nodes: false, requests: false },
      {
        startApp: async () => app(),
        runCases: async () => {
          casesRan = true
          return []
        },
        log,
      },
    )
    expect(casesRan).toBe(false)
    expect(r.runs).toEqual([])
  })
})
