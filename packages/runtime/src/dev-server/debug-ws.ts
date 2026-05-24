import type { Server as HttpServer, IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type { Hono } from "hono"
import { WebSocketServer, type WebSocket } from "ws"
import type { DebugSession } from "./debug-session.js"
import type { ClientMessage } from "./debug-protocol.js"

const WS_PATH = "/__lorien/debug/ws"

function isLoopbackOriginString(origin: string | undefined | null): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    return (
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "[::1]"
    )
  } catch {
    return false
  }
}

export interface AttachDebugWebSocketOptions {
  /** Same Hono app passed to mountWorkflows; reserved for future REST endpoints. */
  app: Hono
  /** Node HTTP server (returned by @hono/node-server's `serve`). */
  server: HttpServer
  /** The DebugSession to wire to. */
  session: DebugSession
}

export function attachDebugWebSocket(opts: AttachDebugWebSocketOptions): void {
  const wss = new WebSocketServer({ noServer: true })

  opts.server.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!req.url || !req.url.startsWith(WS_PATH)) return
      const origin = req.headers.origin
      if (!isLoopbackOriginString(origin)) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req)
      })
    },
  )

  wss.on("connection", (ws: WebSocket) => {
    opts.session.connect(ws)
    ws.on("message", (raw) => {
      let msg: ClientMessage
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage
      } catch {
        return
      }
      void opts.session.onMessage(ws, msg)
    })
    ws.on("close", () => opts.session.disconnect(ws))
    ws.on("error", () => opts.session.disconnect(ws))
  })
}
