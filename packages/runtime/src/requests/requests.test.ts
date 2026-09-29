import { describe, expect, it } from "vitest"
import {
  collectionPathFor,
  evaluateAssertion,
  interpolate,
  interpolateDeep,
  mergeEnvironments,
  parseEnvironments,
  parsePath,
  parseRequestCollection,
  RequestFileError,
  type ResponseSnapshot,
  readPath,
  resolveRequest,
  runRequests,
  runSavedRequest,
  type SavedRequest,
} from "./index.js"

const res = (over: Partial<ResponseSnapshot> = {}): ResponseSnapshot => ({
  status: 201,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: { user: { id: "u1", email: "a@b.co", tags: ["x", "y"] }, items: [{ n: 1 }, { n: 2 }] },
  durationMs: 12,
  ...over,
})

describe("paths", () => {
  it("parses dotted, indexed and quoted segments", () => {
    expect(parsePath("user.id")).toEqual(["user", "id"])
    expect(parsePath("items[1].n")).toEqual(["items", "1", "n"])
    expect(parsePath('data["odd key"]')).toEqual(["data", "odd key"])
    expect(parsePath("a..b")).toBeNull()
  })

  it("reads values and reports missing ones", () => {
    expect(readPath(res().body, "items[1].n")).toEqual({ found: true, value: 2 })
    expect(readPath(res().body, "user.nope")).toEqual({ found: false, value: undefined })
    expect(readPath(res().body, "")).toEqual({ found: true, value: res().body })
  })
})

describe("interpolate", () => {
  it("replaces known variables and records missing ones", () => {
    const missing = new Set<string>()
    expect(interpolate("/users/{{ id }}?t={{token}}", { vars: { id: "7" }, missing })).toBe(
      "/users/7?t={{token}}",
    )
    expect([...missing]).toEqual(["token"])
  })

  it("supports built-in dynamic values", () => {
    const out = interpolate("{{$uuid}}|{{$timestamp}}", { vars: {} })
    const [uuid, ts] = out.split("|")
    expect(uuid).toMatch(/^[0-9a-f-]{20,}$/)
    expect(Number(ts)).toBeGreaterThan(0)
  })

  it("interpolates strings deep inside JSON", () => {
    expect(
      interpolateDeep({ a: ["{{x}}", 1], b: { c: "hi {{x}}" } }, { vars: { x: "X" } }),
    ).toEqual({
      a: ["X", 1],
      b: { c: "hi X" },
    })
  })
})

describe("assertions", () => {
  const check = (a: Parameters<typeof evaluateAssertion>[0], r = res()) => evaluateAssertion(a, r)

  it("status equals", () => {
    expect(check({ target: "status", op: "equals", value: 201 }).pass).toBe(true)
    const fail = check({ target: "status", op: "equals", value: 200 })
    expect(fail.pass).toBe(false)
    expect(fail.message).toBe("expected status equals 200, got 201")
  })

  it("headers are case-insensitive and compare as strings", () => {
    expect(
      check({ target: "header", path: "content-type", op: "contains", value: "json" }).pass,
    ).toBe(true)
    expect(check({ target: "header", path: "x-missing", op: "notExists" }).pass).toBe(true)
  })

  it("body paths with equals, contains (subset), type, matches", () => {
    expect(check({ target: "body", path: "user.id", op: "equals", value: "u1" }).pass).toBe(true)
    expect(
      check({ target: "body", path: "user", op: "contains", value: { email: "a@b.co" } }).pass,
    ).toBe(true)
    expect(check({ target: "body", path: "user.tags", op: "contains", value: ["y"] }).pass).toBe(
      true,
    )
    expect(check({ target: "body", path: "items", op: "type", value: "array" }).pass).toBe(true)
    expect(check({ target: "body", path: "user.email", op: "matches", value: "^a@" }).pass).toBe(
      true,
    )
    expect(check({ target: "body", path: "user.id", op: "exists" }).pass).toBe(true)
    expect(check({ target: "body", path: "user.gone", op: "exists" }).message).toBe(
      "expected body.user.gone exists, got nothing",
    )
  })

  it("duration and numeric comparisons", () => {
    expect(check({ target: "duration", op: "lessThan", value: 500 }).pass).toBe(true)
    expect(check({ target: "body", path: "items[0].n", op: "greaterThan", value: 5 }).pass).toBe(
      false,
    )
  })

  it("an invalid regex fails with a reason instead of throwing", () => {
    const r = check({ target: "body", path: "user.id", op: "matches", value: "(" })
    expect(r.pass).toBe(false)
    expect(r.message).toMatch(/invalid pattern/)
  })
})

describe("parse", () => {
  const valid = {
    lorien: 1,
    requests: [
      {
        id: "create",
        name: "Creates a user",
        method: "post",
        path: "/users",
        body: { kind: "json", json: { email: "{{email}}" } },
        expect: [{ target: "status", op: "equals", value: 201 }],
        capture: { userId: "body.user.id" },
      },
    ],
  }

  it("accepts a valid collection and normalizes the method", () => {
    const c = parseRequestCollection(JSON.stringify(valid))
    expect(c.requests[0]?.method).toBe("POST")
    expect(c.requests[0]?.capture).toEqual({ userId: "body.user.id" })
  })

  it("lists every problem", () => {
    const bad = {
      requests: [
        {
          id: "a",
          name: "A",
          method: "GET",
          path: "/",
          expect: [{ target: "nope", op: "equals" }],
        },
        { id: "a", name: "", method: "GET", path: "/" },
      ],
    }
    try {
      parseRequestCollection(JSON.stringify(bad), "x.requests.json")
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(RequestFileError)
      expect((e as RequestFileError).problems).toEqual([
        "requests[0].expect[0].target must be one of status, header, body, duration",
        "requests[1].name must be a non-empty string",
      ])
    }
  })

  it("rejects invalid JSON with the file name", () => {
    expect(() => parseRequestCollection("{", "a.requests.json")).toThrow(
      /a.requests.json is not valid JSON/,
    )
  })

  it("merges local environment overrides over shared ones", () => {
    const shared = parseEnvironments(
      JSON.stringify({
        default: "local",
        environments: { local: { baseUrl: "http://x", token: "shared" } },
      }),
    )
    const local = parseEnvironments(
      JSON.stringify({ environments: { local: { token: "mine" }, me: { a: "1" } } }),
    )
    expect(mergeEnvironments(shared, local)).toEqual({
      lorien: 1,
      default: "local",
      environments: { local: { baseUrl: "http://x", token: "mine" }, me: { a: "1" } },
    })
  })

  it("derives the collection path from the workflow path", () => {
    expect(collectionPathFor("workflows/users/create.workflow")).toBe(
      "workflows/users/create.requests.json",
    )
  })
})

describe("running", () => {
  const create: SavedRequest = {
    id: "create",
    name: "Create",
    method: "POST",
    path: "/users",
    query: { invite: "{{invite}}" },
    headers: { Authorization: "Bearer {{token}}" },
    body: { kind: "json", json: { email: "{{email}}" } },
    expect: [{ target: "status", op: "equals", value: 201 }],
    capture: { userId: "body.id" },
  }
  const get: SavedRequest = {
    id: "get",
    name: "Get",
    method: "GET",
    path: "/users/{{userId}}",
    expect: [{ target: "body", path: "id", op: "equals", value: "u42" }],
  }

  it("resolves variables into url, headers and body", () => {
    const r = resolveRequest(create, {
      baseUrl: "http://api.test/",
      vars: { invite: "abc", token: "t", email: "e@x.io" },
    })
    expect(r).toEqual({
      method: "POST",
      url: "http://api.test/users?invite=abc",
      headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
      body: '{"email":"e@x.io"}',
    })
  })

  it("threads captured values into later requests", async () => {
    const calls: string[] = []
    const fetch = async (url: string) => {
      calls.push(url)
      return url.endsWith("/users/u42")
        ? Response.json({ id: "u42" })
        : Response.json({ id: "u42" }, { status: 201 })
    }
    const results = await runRequests([create, get], {
      baseUrl: "http://api.test",
      vars: { invite: "i", token: "t", email: "e" },
      fetch,
    })
    expect(calls).toEqual(["http://api.test/users?invite=i", "http://api.test/users/u42"])
    expect(results.map((r) => r.passed)).toEqual([true, true])
    expect(results[0]?.captured).toEqual({ userId: "u42" })
  })

  it("without assertions, passes on < 400 and fails otherwise", async () => {
    const req: SavedRequest = { id: "x", name: "X", method: "GET", path: "/" }
    const ok = await runSavedRequest(req, {
      baseUrl: "http://a",
      fetch: async () => new Response("hi"),
    })
    expect(ok.passed).toBe(true)
    expect(ok.response?.body).toBe("hi")
    const bad = await runSavedRequest(req, {
      baseUrl: "http://a",
      fetch: async () => new Response("no", { status: 404 }),
    })
    expect(bad.passed).toBe(false)
  })

  it("reports network errors and missing variables", async () => {
    const r = await runSavedRequest(get, {
      baseUrl: "http://a",
      fetch: async () => {
        throw new Error("ECONNREFUSED")
      },
    })
    expect(r).toMatchObject({ passed: false, error: "ECONNREFUSED", missingVariables: ["userId"] })
  })

  it("does not send a body on GET", async () => {
    let init: RequestInit | undefined
    await runSavedRequest(
      { id: "g", name: "G", method: "GET", path: "/", body: { kind: "text", text: "x" } },
      {
        baseUrl: "http://a",
        fetch: async (_u, i) => {
          init = i
          return new Response("")
        },
      },
    )
    expect(init?.body).toBeUndefined()
  })
})
