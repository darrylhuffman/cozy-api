import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { defineNode } from "../../define-node.js"
import type { LoadedWorkflow } from "../../dev-server/load.js"
import { mountWorkflows } from "../../dev-server/server.js"
import { parseWorkflow } from "../../workflow/parse.js"

describe("@core/variable", () => {
  it("feeds its value to the nodes that read it", async () => {
    const greet = defineNode({
      inputs: z.object({ name: z.string(), role: z.enum(["member", "admin"]) }),
      outputs: z.object({ text: z.string() }),
      async run({ name, role }) {
        return { text: `${name} is ${role === "admin" ? "an admin" : "a member"}` }
      },
    })
    const wf: LoadedWorkflow = {
      absolutePath: "/fake/workflows/greet.workflow",
      relativePath: "greet.workflow",
      file: parseWorkflow({
        lorien: 1,
        nodes: {
          Request: { uses: "@core/http-request", values: { path: "/greet", method: "GET" } },
          role: { uses: "@core/variable", values: { value: "admin" } },
          Greet: { uses: "./nodes/greet", in: { name: "Request.query.name", role: "role.value" } },
          Response: { uses: "@core/http-response", in: { body: "Greet.text" } },
        },
      }),
    }
    const app = new Hono()
    mountWorkflows(app, [wf], { nodes: { "./nodes/greet": greet }, services: {} })
    const res = await app.fetch(new Request("http://lorien.test/greet?name=Ada"))
    expect(res.status).toBe(200)
    expect(await res.json()).toBe("Ada is an admin")
  })
})
