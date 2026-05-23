import { describe, expect, it } from "vitest"
import { buildTriggerSlice, extractParams } from "./trigger-slice.js"

describe("extractParams", () => {
  it("returns empty object for a no-param template", () => {
    expect(extractParams("/users", "/users")).toEqual({})
  })

  it("extracts a single :param", () => {
    expect(extractParams("/users/:id", "/users/42")).toEqual({ id: "42" })
  })

  it("extracts multiple :params", () => {
    expect(
      extractParams("/orgs/:org/users/:userId", "/orgs/acme/users/42"),
    ).toEqual({ org: "acme", userId: "42" })
  })

  it("returns empty object when segment counts differ", () => {
    expect(extractParams("/users/:id", "/posts/a/42")).toEqual({})
  })
})

describe("buildTriggerSlice", () => {
  it("keeps the trigger and its forward-reachable nodes; drops other triggers", () => {
    const file = {
      lorien: 1 as const,
      nodes: {
        trigA: { uses: "@core/http-request" as const, values: { path: "/a", method: "GET" } },
        trigB: { uses: "@core/http-request" as const, values: { path: "/b", method: "GET" } },
        downA: { uses: "@core/response" as const, in: { body: "trigA.body" } },
        downB: { uses: "@core/response" as const, in: { body: "trigB.body" } },
      },
    }
    const depsByNode = new Map<string, Set<string>>([
      ["trigA", new Set()],
      ["trigB", new Set()],
      ["downA", new Set(["trigA"])],
      ["downB", new Set(["trigB"])],
    ])
    const sliced = buildTriggerSlice(file, "trigA", depsByNode)
    expect(Object.keys(sliced.nodes).sort()).toEqual(["downA", "trigA"])
  })

  it("includes an orphan non-response node that no trigger forward-reaches", () => {
    // `util` has no deps and nothing depends on it — no trigger owns it.
    // It should be pulled into any trigger's slice because it's an orphan.
    const file = {
      lorien: 1 as const,
      nodes: {
        trigA: { uses: "@core/http-request" as const, values: { path: "/a", method: "GET" } },
        respA: { uses: "@core/response" as const, in: { body: "trigA.body" } },
        util: { uses: "./util" as const, in: {} },
      },
    }
    const depsByNode = new Map<string, Set<string>>([
      ["trigA", new Set()],
      ["respA", new Set(["trigA"])],
      ["util", new Set()], // no upstream deps — not reachable from any trigger
    ])
    const sliced = buildTriggerSlice(file, "trigA", depsByNode)
    expect(Object.keys(sliced.nodes).sort()).toEqual(["respA", "trigA", "util"])
  })

  it("excludes a node that is owned exclusively by another trigger", () => {
    // `downB` is reachable only from trigB, so when trigA fires it must be excluded.
    const file = {
      lorien: 1 as const,
      nodes: {
        trigA: { uses: "@core/http-request" as const, values: { path: "/a", method: "GET" } },
        trigB: { uses: "@core/http-request" as const, values: { path: "/b", method: "GET" } },
        respA: { uses: "@core/response" as const, in: { body: "trigA.body" } },
        downB: { uses: "./transform" as const, in: { x: "trigB.body" } },
      },
    }
    const depsByNode = new Map<string, Set<string>>([
      ["trigA", new Set()],
      ["trigB", new Set()],
      ["respA", new Set(["trigA"])],
      ["downB", new Set(["trigB"])],
    ])
    const sliced = buildTriggerSlice(file, "trigA", depsByNode)
    expect(Object.keys(sliced.nodes)).not.toContain("downB")
    expect(Object.keys(sliced.nodes).sort()).toEqual(["respA", "trigA"])
  })

  it("does not pull in a foreign trigger when walking upstream of a shared join node", () => {
    // `join` is reachable from trigA (trigA → join) and also depends on trigB.
    // The ancestor walk from `join` must NOT include trigB in trigA's slice.
    const file = {
      lorien: 1 as const,
      nodes: {
        trigA: { uses: "@core/http-request" as const, values: { path: "/a", method: "GET" } },
        trigB: { uses: "@core/http-request" as const, values: { path: "/b", method: "GET" } },
        join: { uses: "./merge" as const, in: { a: "trigA.body", b: "trigB.body" } },
        resp: { uses: "@core/response" as const, in: { body: "join.out" } },
      },
    }
    // join depends on both triggers; resp depends on join.
    // Forward reachability from trigA: trigA → join → resp.
    // trigB is NOT downstream of trigA — it must not be included.
    const depsByNode = new Map<string, Set<string>>([
      ["trigA", new Set()],
      ["trigB", new Set()],
      ["join", new Set(["trigA", "trigB"])],
      ["resp", new Set(["join"])],
    ])
    const sliced = buildTriggerSlice(file, "trigA", depsByNode)
    expect(Object.keys(sliced.nodes)).not.toContain("trigB")
    expect(Object.keys(sliced.nodes).sort()).toEqual(["join", "resp", "trigA"])
  })
})
