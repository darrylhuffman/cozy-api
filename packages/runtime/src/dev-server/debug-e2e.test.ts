import { createServer, type Server as HttpServer } from "node:http"
import { describe, expect, it } from "vitest"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { WebSocket } from "ws"
import { z } from "zod"
import { defineNode } from "../define-node.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { DebugSession } from "./debug-session.js"
import { attachDebugWebSocket } from "./debug-ws.js"
import { mountWorkflows, type DebugIntegration } from "./server.js"
import {
  installConsoleCapture,
} from "./console-capture.js"
import { isLoopbackOriginString } from "./cors.js"
import type { ServerMessage } from "./debug-protocol.js"
import type { LoadedWorkflow } from "./load.js"

function startServerWithDebug(): Promise<{
  server: HttpServer
  port: number
  session: DebugSession
}> {
  const echoNode = defineNode({
    name: "echo",
    inputs: z.object({ msg: z.string() }),
    outputs: z.object({ msg: z.string() }),
    async run({ msg }) {
      console.log("echo node ran with msg:", msg)
      return { msg }
    },
  })
  const wf: LoadedWorkflow = {
    relativePath: "workflows/echo.workflow",
    file: {
      lorien: 1 as const,
      nodes: {
        request: {
          uses: "@core/http-request" as const,
          values: { method: "POST", path: "/echo" },
        },
        echo: {
          uses: "./nodes/echo" as const,
          in: { msg: "request.body.msg" },
        },
        response: {
          uses: "@core/response" as const,
          in: { body: "echo.msg" },
        },
      },
    },
  } as unknown as LoadedWorkflow

  const app = new Hono()
  const session = new DebugSession()

  installConsoleCapture(({ runId, level, message }) => {
    const startedAt = session.getRunStartedAt(runId)
    if (startedAt === null) return
    session.broadcast({
      type: "log",
      runId,
      level,
      message,
      offsetMs: Date.now() - startedAt,
    })
  })

  const debug: DebugIntegration = {
    newRunId: () => `r-${Math.random().toString(36).slice(2, 10)}`,
    buildRun: (runId, workflowPath, _triggerNodeId, _request) => {
      const startedAt = Date.now()
      const lifecycle = new LifecycleEmitter()
      for (const t of [
        "before-node",
        "after-node",
        "edge-fired",
        "error",
        "complete",
      ] as const) {
        lifecycle.on(t, (ev) =>
          session.broadcast({
            type: "event",
            runId,
            event: ev as never,
            offsetMs: Date.now() - startedAt,
          }),
        )
      }
      const { onBeforeNode, onAfterNode } = session.registerRun(
        workflowPath,
        runId,
        startedAt,
      )
      return { lifecycle, onBeforeNode, onAfterNode }
    },
    onResult: (runId, result, totalMs) => {
      session.broadcast({
        type: "run-complete",
        runId,
        status: result.status,
        body: result.body,
        totalMs,
      })
      session.unregisterRun(runId)
    },
    onError: (runId, err, totalMs) => {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      session.broadcast({
        type: "run-error",
        runId,
        message,
        ...(stack ? { stack } : {}),
      })
      session.unregisterRun(runId)
      void totalMs
    },
  }

  app.use(
    "*",
    cors({
      origin: (origin) =>
        isLoopbackOriginString(origin) ? origin : null,
      allowMethods: ["POST", "GET"],
      allowHeaders: ["content-type"],
    }),
  )

  mountWorkflows(app, [wf], {
    nodes: { "./nodes/echo": echoNode },
    services: {} as never,
    debug,
  })

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://${req.headers.host}${req.url ?? "/"}`
      const init: RequestInit = {
        method: req.method ?? "GET",
        headers: req.headers as Record<string, string>,
      }
      if (req.method && req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        init.body = Buffer.concat(chunks) as unknown as BodyInit
      }
      const r = await app.fetch(new Request(url, init))
      res.writeHead(r.status, Object.fromEntries(r.headers.entries()))
      res.end(await r.text())
    })
    attachDebugWebSocket({ app, server, session })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, port, session })
    })
  })
}

describe("debugger HTTP-driven e2e", () => {
  it("set-breakpoints + HTTP fire + pause + continue + run-complete + log", async () => {
    const { server, port } = await startServerWithDebug()

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

    // Fire via HTTP — the IDE Send button equivalent
    const httpResPromise = fetch(`http://127.0.0.1:${port}/echo`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173",
      },
      body: JSON.stringify({ msg: "hi" }),
    })

    await new Promise((r) => setTimeout(r, 80))
    const paused = received.find((m) => m.type === "paused")
    expect(paused).toBeTruthy()
    const pausedRunId = (paused as Extract<ServerMessage, { type: "paused" }>).runId

    ws.send(JSON.stringify({ type: "continue", runId: pausedRunId }))
    const httpRes = await httpResPromise
    expect(httpRes.status).toBe(200)
    const body = (await httpRes.json()) as string
    expect(body).toBe("hi")

    await new Promise((r) => setTimeout(r, 30))
    const complete = received.find((m) => m.type === "run-complete")
    expect(complete).toBeTruthy()

    const log = received.find((m) => m.type === "log")
    expect(log).toBeTruthy()
    expect((log as Extract<ServerMessage, { type: "log" }>).message).toMatch(
      /echo node ran/,
    )

    ws.close()
    server.close()
  })

  it("two concurrent HTTP requests pause and step independently", async () => {
    const { server, port } = await startServerWithDebug()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://localhost:5173" },
    })
    const received: ServerMessage[] = []
    await new Promise<void>((resolve) => ws.on("open", () => resolve()))
    ws.on("message", (raw) =>
      received.push(JSON.parse(raw.toString()) as ServerMessage),
    )

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

    const fire = (msg: string) =>
      fetch(`http://127.0.0.1:${port}/echo`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:5173",
        },
        body: JSON.stringify({ msg }),
      })
    const p1 = fire("first")
    const p2 = fire("second")
    await new Promise((r) => setTimeout(r, 80))
    const pausedRunIds = received
      .filter((m) => m.type === "paused")
      .map((m) => (m as Extract<ServerMessage, { type: "paused" }>).runId)
    expect(pausedRunIds.length).toBe(2)
    for (const id of pausedRunIds) {
      ws.send(JSON.stringify({ type: "continue", runId: id }))
    }
    await Promise.all([p1, p2])
    ws.close()
    server.close()
  })
})
