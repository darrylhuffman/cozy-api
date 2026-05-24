// packages/runtime/src/dev-server/debug-e2e.test.ts
import { createServer, type Server as HttpServer } from "node:http"
import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { WebSocket } from "ws"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { DebugSession } from "./debug-session.js"
import { attachDebugWebSocket } from "./debug-ws.js"
import type { ServerMessage } from "./debug-protocol.js"
import type { LoadedWorkflow } from "./load.js"

function startEphemeralWith(session: DebugSession) {
  const app = new Hono()
  return new Promise<{ server: HttpServer; port: number }>((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://${req.headers.host}${req.url ?? "/"}`
      const r = await app.fetch(new Request(url, { method: req.method ?? "GET" }))
      res.writeHead(r.status)
      res.end(await r.text())
    })
    attachDebugWebSocket({ app, server, session })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, port })
    })
  })
}

describe("debugger end-to-end", () => {
  it("set-breakpoints + fire + pause + continue + run-complete", async () => {
    const echo = defineNode({
      name: "echo",
      inputs: z.object({ msg: z.string() }),
      outputs: z.object({ msg: z.string() }),
      async run({ msg }) {
        return { msg }
      },
    })
    const wf = {
      relativePath: "workflows/echo.workflow",
      file: {
        lorien: 1 as const,
        nodes: {
          request: {
            uses: "@core/http-request" as const,
            values: { method: "POST", path: "/echo" },
          },
          echo: { uses: "./nodes/echo" as const, in: { msg: "request.body.msg" } },
          response: { uses: "@core/response" as const, in: { body: "echo.msg" } },
        },
      },
    } as unknown as LoadedWorkflow

    const session = new DebugSession({
      getWorkflow: (p) => (p === wf.relativePath ? wf : null),
      getServices: async () => ({}) as never,
      resolveNode: (uses) => (uses === "./nodes/echo" ? echo : null),
    })
    const { server, port } = await startEphemeralWith(session)

    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://localhost:5173" },
    })
    const received: ServerMessage[] = []
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => resolve())
      ws.on("error", reject)
    })
    ws.on("message", (raw) => {
      received.push(JSON.parse(raw.toString()) as ServerMessage)
    })

    ws.send(
      JSON.stringify({
        type: "hello",
        breakpoints: [
          {
            workflowPath: "workflows/echo.workflow",
            nodeId: "echo",
            kind: "before",
          },
        ],
      }),
    )
    await new Promise((r) => setTimeout(r, 30))

    ws.send(
      JSON.stringify({
        type: "fire",
        workflowPath: "workflows/echo.workflow",
        triggerNodeId: "request",
        request: { method: "POST", path: "/echo", body: { msg: "hi" } },
      }),
    )
    // Wait until paused
    await new Promise((r) => setTimeout(r, 80))
    const paused = received.find((m) => m.type === "paused")
    expect(paused).toBeTruthy()
    expect((paused as Extract<ServerMessage, { type: "paused" }>).nodeId).toBe("echo")

    ws.send(JSON.stringify({ type: "continue" }))
    await new Promise((r) => setTimeout(r, 80))
    const complete = received.find((m) => m.type === "run-complete")
    expect(complete).toBeTruthy()
    expect((complete as Extract<ServerMessage, { type: "run-complete" }>).body).toBe("hi")

    ws.close()
    server.close()
  })
})
