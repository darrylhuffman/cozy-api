import { mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"
import { serve } from "@hono/node-server"
import { Hono } from "hono"
import WebSocket from "ws"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AvailabilityProbe } from "./availability.js"
import { attachAgentBroker, mountAgentBroker } from "./server.js"
import { TranscriptStore } from "./transcript.js"
import type { ClientMsg, ServerMsg } from "./types.js"

/**
 * Resolve tsx to a file:// URL so the subprocess can find it regardless of its
 * working directory (on Windows, bare "tsx" in --import fails when the CWD has
 * no local node_modules containing tsx).
 */
const _req = createRequire(import.meta.url)
const TSX_IMPORT = pathToFileURL(_req.resolve("tsx/esm")).href

describe("mountAgentBroker — REST", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lorien-broker-rest-"))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("GET /__lorien/agents/availability returns the probed shape", async () => {
    const app = new Hono()
    const availability = new AvailabilityProbe({
      exec: async () => ({ exitCode: 0, stdout: "v 9.9.9", stderr: "" }),
      now: () => 0,
    })
    mountAgentBroker(app, { projectRoot: root, availability })
    const res = await app.request("/__lorien/agents/availability")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.claude.installed).toBe(true)
    expect(body.codex.installed).toBe(true) // mock exec answers for both
  })

  it("GET /__lorien/agents/chats returns an empty index initially", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const res = await app.request("/__lorien/agents/chats")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe(1)
    expect(body.chats).toEqual([])
  })

  it("GET /__lorien/agents/chats/:id returns 404 when missing", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const res = await app.request("/__lorien/agents/chats/nope")
    expect(res.status).toBe(404)
  })

  it("GET /__lorien/agents/chats/:id returns the transcript when present", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const store = new TranscriptStore(root)
    const id = await store.createChat({ agent: "claude", title: "hi" })
    const res = await app.request(`/__lorien/agents/chats/${id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(id)
    expect(body.events).toEqual([])
  })
})

const MOCK_CLI = resolvePath(
  import.meta.dirname,
  "__fixtures__",
  "mock-cli.ts",
)

interface RunningServer {
  port: number
  close(): Promise<void>
}

async function startTestServer(root: string): Promise<RunningServer> {
  const app = new Hono()
  mountAgentBroker(app, { projectRoot: root })
  const server = serve({ fetch: app.fetch, port: 0 }) as ReturnType<
    typeof createServer
  >
  attachAgentBroker({
    app,
    server,
    projectRoot: root,
    spawnOverride: () => ({
      command: process.execPath,
      argsOverride: ["--import", TSX_IMPORT, MOCK_CLI],
    }),
  })
  await new Promise<void>((r) => server.on("listening", () => r()))
  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("no address")
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => {
          // On Windows, child-process handles take a brief moment to release
          // after SIGTERM, which can cause EBUSY when the caller deletes the
          // temp root. A short pause ensures the OS has released all handles.
          if (process.platform === "win32") {
            setTimeout(r, 250)
          } else {
            r()
          }
        })
      }),
  }
}

function openWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/__lorien/agents/ws`, {
      origin: "http://localhost:5173",
    })
    ws.once("open", () => resolve(ws))
    ws.once("error", reject)
  })
}

async function nextServerMsg(ws: WebSocket): Promise<ServerMsg> {
  return new Promise((resolve, reject) => {
    const onMsg = (raw: WebSocket.RawData) => {
      ws.off("error", onErr)
      resolve(JSON.parse(String(raw)) as ServerMsg)
    }
    const onErr = (e: Error) => {
      ws.off("message", onMsg)
      reject(e)
    }
    ws.once("message", onMsg)
    ws.once("error", onErr)
  })
}

function send(ws: WebSocket, msg: ClientMsg): void {
  ws.send(JSON.stringify(msg))
}

describe("attachAgentBroker — WebSocket", () => {
  let root: string
  let server: RunningServer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "lorien-broker-ws-"))
    server = await startTestServer(root)
  })

  afterEach(async () => {
    await server.close()
    rmSync(root, { recursive: true, force: true })
  })

  it("new_chat returns a chat_created message with an id", async () => {
    const ws = await openWs(server.port)
    send(ws, { type: "new_chat", agent: "claude" })
    const msg = await nextServerMsg(ws)
    expect(msg.type).toBe("chat_created")
    if (msg.type === "chat_created") expect(msg.chatId).toMatch(/.+/)
    ws.close()
  })

  it("user message produces a stream of normalized events", async () => {
    const ws = await openWs(server.port)
    send(ws, { type: "new_chat", agent: "claude" })
    const created = (await nextServerMsg(ws)) as Extract<
      ServerMsg,
      { type: "chat_created" }
    >
    send(ws, { type: "user", chatId: created.chatId, text: "hi" })
    const kinds: string[] = []
    for (let i = 0; i < 4; i++) {
      const m = await nextServerMsg(ws)
      expect(m.type).toBe("event")
      if (m.type === "event") kinds.push(m.event.kind)
    }
    expect(kinds).toEqual([
      "assistant_text",
      "tool_use",
      "tool_result",
      "turn_done",
    ])
    ws.close()
  })

  it("rejects upgrade from non-loopback origin", async () => {
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}/__lorien/agents/ws`,
      { origin: "https://evil.example" },
    )
    await new Promise<void>((resolve, reject) => {
      ws.on("open", () => reject(new Error("should not open")))
      ws.on("unexpected-response", (_req, res) => {
        expect(res.statusCode).toBeGreaterThanOrEqual(400)
        resolve()
      })
      ws.on("error", () => resolve())
    })
  })

  it("cancel kills the subprocess and emits chat_closed", async () => {
    const ws = await openWs(server.port)
    send(ws, { type: "new_chat", agent: "claude" })
    const created = (await nextServerMsg(ws)) as Extract<
      ServerMsg,
      { type: "chat_created" }
    >
    send(ws, { type: "user", chatId: created.chatId, text: "hi" })
    // Consume the first event, then cancel.
    await nextServerMsg(ws)
    send(ws, { type: "cancel", chatId: created.chatId })
    // Drain until we see chat_closed (the in-flight events may arrive first).
    for (let i = 0; i < 20; i++) {
      const m = await nextServerMsg(ws)
      if (m.type === "chat_closed") {
        expect(m.reason).toBe("user_cancel")
        ws.close()
        return
      }
    }
    throw new Error("did not see chat_closed within 20 messages")
  })
})
