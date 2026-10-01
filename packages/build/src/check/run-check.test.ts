import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { runCheckCommand } from "../commands/check.js"
import { formatFinding, runCheck } from "./run-check.js"

let dir: string
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function project(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "lorien-check-"))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const DB = `import { defineProvider } from "@darrylondil/lorien-runtime"
import pg from "pg"
export default defineProvider({ selector: "db", create: () => new pg.Pool() })
`

describe("runCheck", () => {
  it("passes a project that keeps things where they belong", async () => {
    const root = project({
      "providers/db.ts": DB,
      "providers/logger.ts": `export interface Logger { info(m: string): void }
export default defineProvider({ selector: "logger", lifetime: "scoped", create: () => console })
`,
      "nodes/list.ts": `import type { Pool } from "pg"
export default defineNode({ run: async (i, { db }) => db.query("select 1") })
`,
    })
    expect((await runCheck(root)).findings).toEqual([])
  })

  it("flags a workflow whose node file was renamed or moved", async () => {
    const root = project({
      "nodes/books/find-book.ts": "export default defineNode({})\n",
      "workflows/books/get.workflow": JSON.stringify({
        lorien: 1,
        nodes: {
          Request: { uses: "@core/http-request", values: { path: "/books/:id" } },
          Find: { uses: "./nodes/books/find-book", after: ["Request"] },
          Load: { uses: "./nodes/books/get-book", after: ["Find"] },
        },
      }),
    })
    const { findings } = await runCheck(root)
    expect(findings.map((f) => [f.rule, f.severity, f.file, f.message])).toEqual([
      [
        "workflow-uses",
        "error",
        "workflows/books/get.workflow",
        "Load uses `./nodes/books/get-book`, but there is no such node file.",
      ],
    ])
  })

  it("checks sub-workflows: their own uses, and nodes that wire them wrongly", async () => {
    const root = project({
      "nodes/books/find-book.ts": "export default defineNode({})\n",
      "nodes/books/require-book.workflow": JSON.stringify({
        lorien: 1,
        nodes: {
          Input: { uses: "@core/input", values: { fields: { id: "string" } } },
          Find: { uses: "./nodes/books/find-book", in: { id: "Input.id" } },
          Gone: { uses: "./nodes/books/gone", after: ["Find"] },
          Output: { uses: "@core/output", in: { book: "Find.book" } },
        },
      }),
      "workflows/books/get.workflow": JSON.stringify({
        lorien: 1,
        nodes: {
          Request: { uses: "@core/http-request", values: { path: "/books/:id" } },
          Require: { uses: "./nodes/books/require-book", in: { bookId: "Request.params.id" } },
        },
      }),
    })
    const { findings } = await runCheck(root)
    expect(findings.map((f) => [f.rule, f.file, f.message])).toEqual([
      [
        "workflow-uses",
        "nodes/books/require-book.workflow",
        "Gone uses `./nodes/books/gone`, but there is no such node file.",
      ],
      [
        "workflow-load",
        "workflows/books/get.workflow",
        "Require.in.bookId: Require (nodes/books/require-book.workflow) has no input `bookId` (inputs: id)",
      ],
    ])
  })

  it("points a node's driver import at the provider that wraps it", async () => {
    const root = project({
      "providers/db.ts": DB,
      "nodes/list.ts": `import pg from "pg"\nimport { MongoClient } from "mongodb"\nexport default defineNode({})\n`,
    })
    const { findings } = await runCheck(root)
    expect(findings.map((f) => [f.rule, f.file, f.line, f.message])).toEqual([
      ["node-imports-driver", "nodes/list.ts", 1, "node imports pg directly"],
      ["node-imports-driver", "nodes/list.ts", 2, "node imports mongodb directly"],
    ])
    expect(findings[0]!.fix).toContain("run(input, { db })")
    expect(findings[1]!.fix).toContain("in a provider")
  })

  it("flags process.env in a node once per variable", async () => {
    const root = project({
      "nodes/send.ts": `export default defineNode({
  run: async () => {
    const a = process.env.MAIL_KEY
    const b = process.env["MAIL_KEY"]
    return { a, b, all: process.env }
  },
})
`,
    })
    const { findings } = await runCheck(root)
    expect(findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      ["node-reads-env", 3, "node reads process.env.MAIL_KEY"],
      ["node-reads-env", 5, "node reads process.env"],
    ])
    expect(findings[0]!.fix).toContain("env schema")
  })

  it("flags business functions exported from a provider, not types or the default", async () => {
    const root = project({
      "providers/users.ts": `export interface User { id: string }
export type Id = string
export function createUser(name: string) { return { name } }
export const deleteUser = async (id: string) => {}
export default defineProvider({ selector: "users", create: () => ({}) })
`,
    })
    const { findings, warnings } = await runCheck(root)
    expect(warnings).toBe(2)
    expect(findings.map((f) => [f.rule, f.line, f.message])).toEqual([
      [
        "provider-exports-logic",
        3,
        "provider exports createUser(), but a provider only sets up a dependency",
      ],
      [
        "provider-exports-logic",
        4,
        "provider exports deleteUser(), but a provider only sets up a dependency",
      ],
    ])
    expect(findings[0]!.fix).toContain("into a node in nodes/")
  })

  it("errors on bad selectors and a singleton using a scoped provider", async () => {
    const root = project({
      "providers/a.ts": `export default defineProvider({ selector: "db", uses: ["log"], create: () => 1 })\n`,
      "providers/b.ts": `export default defineProvider({ selector: "db", create: () => 1 })\n`,
      "providers/log.ts": `export default defineProvider({ selector: "log", lifetime: "scoped", create: () => 1 })\n`,
    })
    const { findings, errors } = await runCheck(root)
    expect(errors).toBe(2)
    expect(findings.map((f) => [f.rule, f.file])).toEqual([
      ["provider-lifetime", "providers/a.ts"],
      ["provider-selector", "providers/b.ts"],
    ])
  })
})

describe("lorien check", () => {
  it("fails on errors, and on warnings only with --strict", async () => {
    const root = project({
      "nodes/n.ts": `export default defineNode({ run: () => process.env.X })\n`,
    })
    const lines: string[] = []
    expect((await runCheckCommand({ root }, (l) => lines.push(l))).exitCode).toBe(0)
    expect(lines.join("\n")).toContain("! nodes/n.ts:1  node reads process.env.X")
    expect((await runCheckCommand({ root, strict: true }, () => {})).exitCode).toBe(1)
  })

  it("formats a finding with its fix on the next line", () => {
    expect(
      formatFinding({
        rule: "r",
        severity: "error",
        file: "providers/a.ts",
        line: 2,
        message: "bad",
        fix: "do this",
      }),
    ).toBe("✗ providers/a.ts:2  bad\n    do this")
  })
})
