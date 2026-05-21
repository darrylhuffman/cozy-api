import type { Server as HttpServer, IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type { Hono } from "hono"
import { WebSocketServer, type WebSocket } from "ws"
import { AvailabilityProbe } from "./availability.js"
import {
  spawnClaude,
  type ClaudeProcess,
  type SpawnClaudeOptions,
} from "./subprocess.js"
import { SubscriberRegistry, type SocketLike } from "./subscribers.js"
import {
  appendChatEvent,
  createChat,
  listChats,
  loadChat,
} from "./transcript.js"
import type {
  AgentName,
  ClientMsg,
  ServerMsg,
} from "./types.js"

export interface MountAgentBrokerOptions {
  projectRoot: string
  /** Inject a custom probe in tests; defaults to the real one. */
  availability?: AvailabilityProbe
}

export function mountAgentBroker(
  app: Hono,
  opts: MountAgentBrokerOptions,
): void {
  const availability = opts.availability ?? new AvailabilityProbe()

  app.get("/__lorien/agents/availability", async (c) => {
    const r = await availability.probe()
    return c.json(r)
  })

  app.get("/__lorien/agents/chats", async (c) => {
    const idx = await listChats(opts.projectRoot)
    return c.json(idx)
  })

  app.get("/__lorien/agents/chats/:id", async (c) => {
    const id = c.req.param("id")
    const chat = await loadChat(opts.projectRoot, id)
    if (!chat) return c.json({ error: "not found" }, 404)
    return c.json(chat)
  })
}

export interface AttachAgentBrokerOptions {
  /** Same Hono app that was passed to mountAgentBroker. */
  app: Hono
  /** Node HTTP server (e.g. returned by @hono/node-server's `serve`). */
  server: HttpServer
  projectRoot: string
  /** Test injection: override spawnClaude args without touching production code. */
  spawnOverride?: () => Pick<SpawnClaudeOptions, "command" | "argsOverride">
}

const WS_PATH = "/__lorien/agents/ws"

function isLoopbackOrigin(origin: string | undefined): boolean {
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

interface ChatLifecycle {
  proc: ClaudeProcess | null
  sessionId: string | null
}

export function attachAgentBroker(opts: AttachAgentBrokerOptions): void {
  const subs = new SubscriberRegistry()
  const chats = new Map<string, ChatLifecycle>()

  const wss = new WebSocketServer({ noServer: true })

  const sockets = new WeakMap<WebSocket, SocketLike>()

  function getSocket(ws: WebSocket): SocketLike {
    let s = sockets.get(ws)
    if (!s) {
      s = {
        send: (data) => ws.send(data),
        isOpen: () => ws.readyState === ws.OPEN,
      }
      sockets.set(ws, s)
    }
    return s
  }

  function emit(chatId: string, msg: ServerMsg): void {
    subs.broadcast(chatId, msg)
  }

  async function ensureChat(chatId: string): Promise<ChatLifecycle> {
    let c = chats.get(chatId)
    if (!c) {
      c = { proc: null, sessionId: null }
      chats.set(chatId, c)
    }
    return c
  }

  async function pumpProcess(
    chatId: string,
    proc: ClaudeProcess,
  ): Promise<void> {
    for await (const event of proc.events) {
      await appendChatEvent(opts.projectRoot, chatId, event).catch(() => {
        /* swallow disk errors — event already in flight to subscribers */
      })
      emit(chatId, { type: "event", chatId, event })
    }
  }

  async function startProcess(
    chatId: string,
    lifecycle: ChatLifecycle,
  ): Promise<ClaudeProcess> {
    const override = opts.spawnOverride?.()
    const proc = spawnClaude({
      chatId,
      projectRoot: opts.projectRoot,
      ...(lifecycle.sessionId !== null
        ? { resumeSessionId: lifecycle.sessionId }
        : {}),
      ...(override ?? {}),
    })
    lifecycle.proc = proc
    void pumpProcess(chatId, proc).catch(() => {
      /* iteration ended; close handled below */
    })
    proc.exit.then((code) => {
      // Distinguish "we're still the active process" (subprocess exited on its own)
      // from "we've been cancelled and lifecycle.proc was already cleared" (the
      // cancel handler already emitted chat_closed).
      const ownedByUs = chats.get(chatId)?.proc === proc
      if (ownedByUs) {
        emit(chatId, { type: "chat_closed", chatId, reason: "subprocess_exit" })
        lifecycle.proc = null
      }
      // Capture session id from the process for future resume.
      const sid = proc.sessionId()
      if (sid) lifecycle.sessionId = sid
      void code // unused
    })
    return proc
  }

  async function handleMessage(
    ws: WebSocket,
    raw: string,
  ): Promise<void> {
    let msg: ClientMsg
    try {
      msg = JSON.parse(raw) as ClientMsg
    } catch {
      return
    }

    switch (msg.type) {
      case "new_chat": {
        if (msg.agent !== "claude") {
          // Codex not implemented in this plan; respond with an error.
          ws.send(
            JSON.stringify({
              type: "agent_error",
              chatId: "",
              message: "Codex CLI integration is not implemented yet",
              recoverable: false,
            } satisfies ServerMsg),
          )
          return
        }
        const id = await createChat(opts.projectRoot, {
          agent: msg.agent as AgentName,
          title: "untitled",
        })
        subs.subscribe(id, getSocket(ws))
        ws.send(
          JSON.stringify({
            type: "chat_created",
            chatId: id,
          } satisfies ServerMsg),
        )
        return
      }
      case "open_chat": {
        subs.subscribe(msg.chatId, getSocket(ws))
        return
      }
      case "user": {
        const lifecycle = await ensureChat(msg.chatId)
        const event = {
          kind: "user_message" as const,
          text: msg.text,
          at: new Date().toISOString(),
        }
        // Persist to transcript but do NOT broadcast back — the sender already
        // knows what they typed; echo would cause duplicates in the UI.
        await appendChatEvent(opts.projectRoot, msg.chatId, event).catch(
          () => undefined,
        )

        if (!lifecycle.proc) {
          lifecycle.proc = await startProcess(msg.chatId, lifecycle)
        }
        lifecycle.proc.send(msg.text)
        return
      }
      case "cancel": {
        const lifecycle = chats.get(msg.chatId)
        if (lifecycle?.proc) {
          lifecycle.proc.kill()
          lifecycle.proc = null
        }
        emit(msg.chatId, {
          type: "chat_closed",
          chatId: msg.chatId,
          reason: "user_cancel",
        })
        return
      }
    }
  }

  wss.on("connection", (ws) => {
    const socket = getSocket(ws)
    ws.on("message", (data) => {
      void handleMessage(ws, String(data))
    })
    ws.on("close", () => {
      subs.unsubscribeAll(socket)
      // If no subscribers remain for any chat with a live process, kill the process.
      for (const [id, lifecycle] of chats) {
        if (lifecycle.proc && !subs.isAnyOnline(id)) {
          lifecycle.proc.kill()
          lifecycle.proc = null
        }
      }
    })
  })

  opts.server.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = req.url ?? ""
      if (!url.startsWith(WS_PATH)) return
      const origin = req.headers.origin
      if (!isLoopbackOrigin(origin)) {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n",
        )
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req)
      })
    },
  )

  // When the HTTP server closes, kill all live subprocesses so they don't
  // hold the working directory open (important on Windows where open handles
  // prevent directory deletion).
  opts.server.on("close", () => {
    for (const [, lifecycle] of chats) {
      if (lifecycle.proc) {
        lifecycle.proc.kill()
        lifecycle.proc = null
      }
    }
  })
}
