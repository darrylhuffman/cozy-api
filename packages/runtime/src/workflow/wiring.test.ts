import { describe, expect, it } from "vitest"
import { z } from "zod"
import { resolveCoreNode } from "../core/registry.js"
import { defineNode } from "../define-node.js"
import type { AnyNodeOrTrigger } from "../types.js"
import { parseWorkflow } from "./parse.js"
import { checkWiring } from "./wiring.js"

const nodes: Record<string, AnyNodeOrTrigger> = {
  "./nodes/find-book": defineNode({
    inputs: z.object({ id: z.coerce.number(), include: z.string().optional() }),
    outputs: z.object({ book: z.object({ title: z.string() }).nullable(), found: z.boolean() }),
    async run() {
      return { book: null, found: false }
    },
  }),
  "./nodes/loose": defineNode({
    inputs: z.looseObject({}),
    outputs: z.looseObject({}),
    async run() {
      return {}
    },
  }),
}
const resolve = (uses: string) => resolveCoreNode(uses) ?? nodes[uses] ?? null

function issues(workflowNodes: Record<string, unknown>) {
  return checkWiring(parseWorkflow({ lorien: 1, nodes: workflowNodes }), resolve).map(
    (i) => `${i.nodeId}.${i.field}: ${i.message}`,
  )
}

const request = { uses: "@core/http-request", values: { path: "/books/:id", method: "GET" } }

describe("checkWiring", () => {
  it("accepts a workflow wired to real inputs and outputs", () => {
    expect(
      issues({
        Request: request,
        Find: { uses: "./nodes/find-book", in: { id: "Request.params.id" } },
        Found: {
          uses: "@core/http-response",
          when: "Find.found",
          in: { body: "Find.book.title" },
          values: { status: 200 },
        },
      }),
    ).toEqual([])
  })

  it("names an input the node doesn't have, and one nothing feeds", () => {
    expect(
      issues({
        Request: request,
        Find: { uses: "./nodes/find-book", in: { bookId: "Request.params.id" } },
      }),
    ).toEqual([
      "Find.in.bookId: Find (./nodes/find-book) has no input `bookId` (inputs: id, include)",
      "Find.in.id: Find needs input `id`, but nothing is wired to it in `in` or `values`",
    ])
  })

  it("names an output field the referenced node doesn't declare", () => {
    expect(
      issues({
        Request: request,
        Find: { uses: "./nodes/find-book", in: { id: "Request.param.id" } },
        Res: { uses: "@core/http-response", when: "!Find.exists", in: { body: "Find.books" } },
      }),
    ).toEqual([
      "Find.in.id: `Request.param.id` reads output `param`, but Request has no such output (outputs: body, params, query, headers, context)",
      "Res.in.body: `Find.books` reads output `books`, but Find has no such output (outputs: book, found)",
      "Res.when: `Find.exists` reads output `exists`, but Find has no such output (outputs: book, found)",
    ])
  })

  it("says a renamed node file needs its uses updated", () => {
    expect(
      issues({ Request: request, Find: { uses: "./nodes/get-book", after: ["Request"] } }),
    ).toEqual([
      "Find.uses: `./nodes/get-book` doesn't match a node file; if you renamed or moved it, update `uses`",
    ])
  })

  it("leaves schemas that allow any key alone", () => {
    expect(
      issues({ Request: request, L: { uses: "./nodes/loose", in: { anything: "Request.body" } } }),
    ).toEqual([])
  })

  it("checks a switch's branches against its cases", () => {
    expect(
      issues({
        Request: request,
        Kind: {
          uses: "@core/switch",
          in: { value: "Request.query" },
          values: { field: "kind", cases: ["a", "b"] },
        },
        A: { uses: "@core/http-response", when: "Kind.case2" },
        B: { uses: "@core/http-response", when: "Kind.default", in: { body: "Kind.value" } },
        C: { uses: "@core/http-response", when: "Kind.case3" },
      }),
    ).toEqual([
      "C.when: `Kind.case3` reads output `case3`, but Kind has no such output (outputs: case1, case2, default, value)",
    ])
  })
})
