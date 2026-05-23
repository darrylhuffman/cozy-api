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
})
