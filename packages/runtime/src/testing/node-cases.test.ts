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
