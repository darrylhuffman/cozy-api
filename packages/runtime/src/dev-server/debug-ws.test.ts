import { createServer, type Server as HttpServer } from "node:http"
import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { Hono } from "hono"
import { DebugSession } from "./debug-session.js"
import { attachDebugWebSocket } from "./debug-ws.js"

function startEphemeral(): Promise<{ server: HttpServer; port: number; app: Hono }> {
  const app = new Hono()
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://${req.headers.host}${req.url ?? "/"}`
      const r = await app.fetch(new Request(url, { method: req.method ?? "GET" }))
      res.writeHead(r.status)
      res.end(await r.text())
    })
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, port, app })
    })
  })
}

describe("attachDebugWebSocket", () => {
  it("upgrades on /__lorien/debug/ws and routes hello → ready", async () => {
    const { server, port, app } = await startEphemeral()
    const session = new DebugSession({
      getWorkflow: () => null,
      getServices: async () => ({}) as never,
      resolveNode: () => null,
    })
    attachDebugWebSocket({ app, server, session })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://localhost:5173" },
    })
    const ready = await new Promise<unknown>((resolve, reject) => {
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", breakpoints: [] }))
      })
      ws.on("message", (data) => resolve(JSON.parse(data.toString())))
      ws.on("error", reject)
      setTimeout(() => reject(new Error("timeout")), 1000)
    })
    expect((ready as { type: string }).type).toBe("ready")
    ws.close()
    server.close()
  })

  it("rejects non-loopback origins on upgrade", async () => {
    const { server, port, app } = await startEphemeral()
    const session = new DebugSession({
      getWorkflow: () => null,
      getServices: async () => ({}) as never,
      resolveNode: () => null,
    })
    attachDebugWebSocket({ app, server, session })
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/debug/ws`, {
      headers: { origin: "http://evil.example.com" },
    })
    await new Promise<void>((resolve) => {
      ws.on("error", () => resolve())
      ws.on("unexpected-response", () => resolve())
    })
    server.close()
  })
})
