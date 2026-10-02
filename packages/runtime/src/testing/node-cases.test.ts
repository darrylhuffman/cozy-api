import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { runNodeCase, runNodeCases } from "./node-cases.js"

const saveUser = defineNode({
  inputs: z.object({ email: z.string().email() }),
  outputs: z.object({ user: z.object({ id: z.string(), email: z.string() }) }),
  async run({ email }, services) {
    const db = (services as { db: { create(e: string): Promise<{ id: string }> } }).db
    const { id } = await db.create(email)
    return { user: { id, email } }
  },
})

const broken = defineNode({
  inputs: z.object({}),
  outputs: z.object({ n: z.number() }),
  async run() {
    return { n: "not a number" } as unknown as { n: number }
  },
})

describe("runNodeCase", () => {
  it("runs with mocked services and checks a subset of the output", async () => {
    const r = await runNodeCase(saveUser, {
      id: "a",
      name: "saves",
      input: { email: "a@b.co" },
      mocks: { db: { create: { returns: { id: "u1" } } } },
      expect: { output: { user: { id: "u1" } } },
    })
    expect(r).toMatchObject({
      passed: true,
      output: { user: { id: "u1", email: "a@b.co" } },
      failures: [],
    })
  })

  it("reports input validation like the interpreter does", async () => {
    const r = await runNodeCase(saveUser, {
      id: "b",
      name: "bad",
      input: { email: "nope" },
      expect: { error: "email" },
    })
    expect(r.passed).toBe(true)
    expect(r.error).toMatch(/^input validation failed at `email`/)
  })

  it("mocks sync provider methods: the node gets the value, and a throw is catchable", async () => {
    const hasOverlap = defineNode({
      inputs: z.object({}),
      outputs: z.object({ overlap: z.boolean(), failed: z.boolean() }),
      async run(_input, services) {
        const db = (services as { db: { findOverlap(): { id: number } | undefined } }).db
        try {
          return { overlap: db.findOverlap() !== undefined, failed: false }
        } catch {
          return { overlap: false, failed: true }
        }
      },
    })
    const found = await runNodeCase(hasOverlap, {
      id: "found",
      name: "overlap",
      input: {},
      mocks: { db: { findOverlap: { returns: { id: 1 } } } },
      expect: { output: { overlap: true } },
    })
    expect(found.output).toEqual({ overlap: true, failed: false })
    const locked = await runNodeCase(hasOverlap, {
      id: "locked",
      name: "db locked",
      input: {},
      mocks: { db: { findOverlap: { throws: "database is locked" } } },
      expect: { output: { failed: true } },
    })
    expect(locked.passed).toBe(true)
  })

  it("fails on a thrown mock, and on output that breaks the schema", async () => {
    const thrown = await runNodeCase(saveUser, {
      id: "c",
      name: "db down",
      input: { email: "a@b.co" },
      mocks: { db: { create: { throws: "db down" } } },
      expect: { output: {} },
    })
    expect(thrown.failures).toEqual(["threw: db down"])
    const shape = await runNodeCase(broken, { id: "d", name: "shape", input: {}, expect: {} })
    expect(shape.passed).toBe(false)
    expect(shape.failures[0]).toMatch(/output does not match the node's outputs schema at `n`/)
  })

  it("times out", async () => {
    const slow = defineNode({
      inputs: z.object({}),
      outputs: z.object({}),
      run: () => new Promise(() => {}),
    })
    const r = await runNodeCase(
      slow,
      { id: "e", name: "slow", input: {}, expect: {} },
      { timeoutMs: 20 },
    )
    expect(r.failures).toEqual(["threw: timed out after 20ms"])
  })
})

describe("runNodeCases", () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lorien-cases-"))
    await mkdir(join(root, "nodes/users"), { recursive: true })
    await writeFile(
      join(root, "nodes/users/save-user.cases.json"),
      JSON.stringify({
        lorien: 1,
        cases: [
          {
            id: "a",
            name: "saves",
            input: { email: "a@b.co" },
            expect: { output: { user: { id: "real" } } },
          },
          { id: "b", name: "rejects", input: { email: "x" }, expect: { error: "" } },
        ],
      }),
    )
    await writeFile(join(root, "nodes/ghost.cases.json"), JSON.stringify({ lorien: 1, cases: [] }))
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it("runs each file against its node with the given services", async () => {
    const out = await runNodeCases({
      root,
      nodes: { "./nodes/users/save-user": saveUser },
      services: { db: { create: async () => ({ id: "real" }) } } as never,
    })
    expect(out.map((f) => [f.path, f.error, f.results.map((r) => r.passed)])).toEqual([
      ["nodes/ghost.cases.json", "no node found at nodes/ghost.ts", []],
      ["nodes/users/save-user.cases.json", undefined, [true, true]],
    ])
  })

  it("can run only some cases", async () => {
    const out = await runNodeCases({
      root,
      filter: "save-user",
      only: { "nodes/users/save-user.cases.json": ["b"] },
      nodes: { "./nodes/users/save-user": saveUser },
      services: {} as never,
    })
    expect(out[0]?.results.map((r) => r.caseId)).toEqual(["b"])
  })
})

describe("sub-workflow cases", () => {
  let root: string
  const findUser = defineNode({
    inputs: z.object({ id: z.string() }),
    outputs: z.object({ found: z.boolean(), user: z.any() }),
    async run({ id }) {
      return id === "u1" ? { found: true, user: { id, name: "Ada" } } : { found: false, user: null }
    },
  })
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lorien-subcases-"))
    await mkdir(join(root, "nodes/users"), { recursive: true })
    await writeFile(
      join(root, "nodes/users/require-user.workflow"),
      JSON.stringify({
        lorien: 1,
        nodes: {
          Input: { uses: "@core/input", values: { fields: { id: "string" } } },
          Find: { uses: "./nodes/users/find-user", in: { id: "Input.id" } },
          Missing: {
            uses: "@core/http-response",
            when: "!Find.found",
            values: { status: 404, body: { error: "no user" } },
          },
          Output: { uses: "@core/output", in: { user: "Find.user" } },
        },
      }),
    )
    await writeFile(
      join(root, "nodes/users/require-user.cases.json"),
      JSON.stringify({
        lorien: 1,
        cases: [
          {
            id: "found",
            name: "hands back the user",
            input: { id: "u1" },
            expect: { output: { user: { name: "Ada" } } },
          },
          {
            id: "missing",
            name: "answers 404",
            input: { id: "nope" },
            expect: { output: { response: { status: 404, body: { error: "no user" } } } },
          },
          { id: "typed", name: "checks input types", input: { id: 7 }, expect: { error: "id" } },
          {
            id: "unknown",
            name: "refuses unknown inputs",
            input: { x: 1 },
            expect: { error: "x" },
          },
        ],
      }),
    )
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it("feeds the case through the Input and checks what the Output hands back", async () => {
    const out = await runNodeCases({
      root,
      nodes: { "./nodes/users/find-user": findUser },
      services: {} as never,
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.error).toBeUndefined()
    expect(out[0]?.results.map((r) => [r.caseId, r.passed, r.failures])).toEqual([
      ["found", true, []],
      ["missing", true, []],
      ["typed", true, []],
      ["unknown", true, []],
    ])
  })
})
