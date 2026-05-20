import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { parseWorkflow } from "../workflow/parse.js"
import type { LoadedWorkflow } from "./load.js"
import { mountWorkflows } from "./server.js"

describe("mountWorkflows", () => {
  it("registers HTTP routes from workflows and responds to fetch", async () => {
    const add = defineNode({
      inputs: z.object({ a: z.number(), b: z.number() }),
      outputs: z.object({ sum: z.number() }),
      async run({ a, b }) {
        return { sum: a + b }
      },
    })

    const wf: LoadedWorkflow = {
      absolutePath: "/fake/workflows/add.workflow",
      relativePath: "add.workflow",
      file: parseWorkflow({
        cozy: 1,
        nodes: {
          req: { uses: "@core/http-request", config: { path: "/add", method: "POST" } },
          add: { uses: "./add", in: { a: "req.body.a", b: "req.body.b" } },
          res: { uses: "@core/response", in: { body: "add.sum", status: 200 } },
        },
      }),
    }

    const app = new Hono()
    mountWorkflows(app, [wf], {
      nodes: { "./add": add },
      services: {},
    })

    const res = await app.request("/add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 3, b: 4 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toBe(7)
  })

  it("registers multiple triggers in a single workflow as independent routes", async () => {
    const wf: LoadedWorkflow = {
      absolutePath: "/fake/users.workflow",
      relativePath: "users.workflow",
      file: parseWorkflow({
        cozy: 1,
        nodes: {
          getReq: { uses: "@core/http-request", config: { path: "/users", method: "GET" } },
          postReq: { uses: "@core/http-request", config: { path: "/users", method: "POST" } },
          getRes: { uses: "@core/response", in: { body: { $literal: "list" } } },
          postRes: { uses: "@core/response", in: { body: "postReq.body" } },
        },
      }),
    }
    const app = new Hono()
    mountWorkflows(app, [wf], { nodes: {}, services: {} })

    const getRes = await app.request("/users", { method: "GET" })
    expect(await getRes.json()).toBe("list")

    const postRes = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ada" }),
    })
    expect(await postRes.json()).toEqual({ name: "ada" })
  })
})
