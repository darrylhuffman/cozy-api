import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  failureSummary,
  findCollectionFiles,
  runRequestCollections,
} from "./request-collections.js"

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lorien-requests-"))
  await mkdir(join(root, "workflows/users"), { recursive: true })
  await writeFile(
    join(root, "lorien.environments.json"),
    JSON.stringify({
      default: "local",
      environments: { local: { baseUrl: "http://nowhere", name: "Ada" } },
    }),
  )
  await writeFile(
    join(root, "workflows/users/create.requests.json"),
    JSON.stringify({
      lorien: 1,
      requests: [
        {
          id: "create",
          name: "creates a user",
          method: "POST",
          path: "/users",
          body: { kind: "json", json: { name: "{{name}}" } },
          expect: [
            { target: "status", op: "equals", value: 201 },
            { target: "body", path: "name", op: "equals", value: "Ada" },
          ],
          capture: { id: "body.id" },
        },
        {
          id: "get",
          name: "fetches it",
          method: "GET",
          path: "/users/{{id}}",
          expect: [{ target: "status", op: "equals", value: 200 }],
        },
      ],
    }),
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function app() {
  const a = new Hono()
  a.post("/users", async (c) => c.json({ id: "u1", ...(await c.req.json()) }, 201))
  a.get("/users/:id", (c) => (c.req.param("id") === "u1" ? c.json({ id: "u1" }) : c.json({}, 404)))
  return a
}

describe("runRequestCollections", () => {
  it("finds collections under workflows/", async () => {
    await writeFile(join(root, "workflows/broken.requests.json"), "{")
    expect(await findCollectionFiles(root)).toEqual([
      "workflows/broken.requests.json",
      "workflows/users/create.requests.json",
    ])
  })

  it("runs in-process against the app with environment variables, ignoring the env baseUrl", async () => {
    const runs = await runRequestCollections({ root, app: app() })
    expect(runs).toHaveLength(1)
    expect(runs[0]?.results.map((r) => [r.name, r.passed])).toEqual([
      ["creates a user", true],
      ["fetches it", true],
    ])
  })

  it("reports unreadable files and failing assertions", async () => {
    await writeFile(join(root, "workflows/broken.requests.json"), "{")
    const bad = new Hono()
    bad.post("/users", (c) => c.json({ id: "u1", name: "Bob" }, 200))
    const runs = await runRequestCollections({ root, app: bad })
    expect(runs[0]?.error).toMatch(/not valid JSON/)
    expect(failureSummary(runs[1]!.results[0]!)).toEqual([
      "expected status equals 201, got 200",
      'expected body.name equals "Ada", got "Bob"',
    ])
  })

  it("rejects an unknown environment with the known names", async () => {
    await expect(runRequestCollections({ root, app: app(), env: "prod" })).rejects.toThrow(
      'Unknown environment "prod" (known: local)',
    )
  })
})
