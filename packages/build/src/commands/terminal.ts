import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import type { Server as HttpServer, IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import type { Hono } from "hono"
import { type WebSocket, WebSocketServer } from "ws"

/**
 * The IDE's integrated terminal: a real shell on the developer's machine,
 * run in a pseudo-terminal (node-pty) and drawn in the browser by xterm.js.
 *
 * It is `lorien ide` only, never part of a built app. Because it runs any
 * command, a socket is accepted only when all three hold: it comes from this
 * machine, from a page on localhost, and carries the token this server hands
 * to its own IDE page.
 */

export interface Shell {
  id: string
  label: string
  path: string
  args: string[]
}

/** The subset of node-pty we use. */
interface Pty {
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}
type Spawn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => Pty

let ptyModule: Promise<{ spawn: Spawn } | { error: string }> | null = null

/** Loads node-pty once. It is an optional dependency with prebuilt binaries per platform. */
export function loadPty(): Promise<{ spawn: Spawn } | { error: string }> {
  // A variable specifier keeps the bundler from trying to inline a native module.
  const name = "@lydell/node-pty"
  ptyModule ??= import(name).then(
    (m: { spawn: Spawn; default?: { spawn: Spawn } }) => ({ spawn: m.spawn ?? m.default!.spawn }),
    (e: Error) => ({
      error: `The terminal needs @lydell/node-pty, which didn't load on ${process.platform}-${process.arch}: ${e.message}`,
    }),
  )
  return ptyModule
}

/** The shells this machine offers, the default first. */
export function detectShells(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
): Shell[] {
  if (platform === "win32") {
    const root = env.SystemRoot ?? "C:\\Windows"
    const shells: Shell[] = [
      {
        id: "powershell",
        label: "PowerShell",
        path: `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
        args: ["-NoLogo"],
      },
      {
        id: "cmd",
        label: "Command Prompt",
        path: env.ComSpec ?? `${root}\\System32\\cmd.exe`,
        args: [],
      },
    ]
    const pwsh = [`${env.ProgramFiles ?? "C:\\Program Files"}\\PowerShell\\7\\pwsh.exe`].find(
      exists,
    )
    if (pwsh) shells.unshift({ id: "pwsh", label: "PowerShell 7", path: pwsh, args: ["-NoLogo"] })
    const gitBash = `${env.ProgramFiles ?? "C:\\Program Files"}\\Git\\bin\\bash.exe`
    if (exists(gitBash))
      shells.push({ id: "git-bash", label: "Git Bash", path: gitBash, args: ["--login", "-i"] })
    return shells
  }
  const candidates = [
    env.SHELL,
    platform === "darwin" ? "/bin/zsh" : "/bin/bash",
    "/bin/zsh",
    "/bin/bash",
    "/usr/bin/fish",
    "/opt/homebrew/bin/fish",
    "/bin/sh",
  ]
  const seen = new Set<string>()
  const shells: Shell[] = []
  for (const path of candidates) {
    if (!path || seen.has(path) || !exists(path)) continue
    seen.add(path)
    const name = path.split("/").pop() ?? path
    // Login shells read the user's profile, like a new terminal window does.
    shells.push({ id: name, label: name, path, args: name === "sh" ? [] : ["-l"] })
  }
  return shells
}

function isLoopbackAddress(addr: string | undefined): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1"
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const h = new URL(origin).hostname
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]"
  } catch {
    return false
  }
}

export type ClientMsg = { t: "in"; d: string } | { t: "resize"; cols: number; rows: number }

export type ServerMsg = { t: "out"; d: string } | { t: "exit"; code: number }

const WS_PATH = "/api/terminal/socket"

/** One token and shell list per workspace, shared by every rebuild of the IDE app. */
const sessions = new Map<string, { token: string; shells: Shell[] }>()

function sessionFor(cwd: string) {
  let s = sessions.get(cwd)
  if (!s) {
    s = { token: randomBytes(24).toString("hex"), shells: detectShells() }
    sessions.set(cwd, s)
  }
  return s
}

/**
 * GET /api/terminal/info: whether the terminal works here, the shells on
 * offer, and the token the IDE page opens sockets with.
 */
export function mountTerminalRoutes(app: Hono, cwd: string): void {
  app.get("/api/terminal/info", async (c) => {
    // Only the IDE page itself may read the token: this machine, a localhost page.
    const incoming = (c.env as { incoming?: IncomingMessage } | undefined)?.incoming
    const origin = c.req.header("origin")
    if (
      (incoming && !isLoopbackAddress(incoming.socket.remoteAddress)) ||
      (origin && !isLoopbackOrigin(origin))
    ) {
      return c.json({ error: "The terminal is only available from this machine" }, 403)
    }
    const { token, shells } = sessionFor(cwd)
    const pty = await loadPty()
    return c.json({
      available: !("error" in pty),
      ...("error" in pty ? { reason: pty.error } : {}),
      shells: shells.map(({ id, label }) => ({ id, label })),
      token,
    })
  })
}

/** Takes terminal WebSocket upgrades on the IDE's server: one shell per socket. */
export function attachTerminal(server: HttpServer, cwd: string): { closeAll(): void } {
  const { token, shells } = sessionFor(cwd)
  const live = new Set<Pty>()

  const wss = new WebSocketServer({ noServer: true })
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", "http://localhost")
    if (url.pathname !== WS_PATH) return
    if (
      !isLoopbackAddress(req.socket.remoteAddress) ||
      !isLoopbackOrigin(req.headers.origin) ||
      url.searchParams.get("token") !== token
    ) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => void run(ws, url.searchParams))
  })
  const run = async (ws: WebSocket, params: URLSearchParams) => {
    const send = (m: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
    }
    const pty = await loadPty()
    if ("error" in pty) {
      send({ t: "out", d: `\r\n${pty.error}\r\n` })
      ws.close()
      return
    }
    const shell = shells.find((s) => s.id === params.get("shell")) ?? shells[0]
    if (!shell) {
      send({ t: "out", d: "\r\nNo shell found on this machine.\r\n" })
      ws.close()
      return
    }
    const size = (v: string | null, d: number) => Math.min(Math.max(Number(v) || d, 2), 1000)
    let proc: Pty
    try {
      proc = pty.spawn(shell.path, shell.args, {
        name: "xterm-256color",
        cols: size(params.get("cols"), 80),
        rows: size(params.get("rows"), 24),
        cwd,
        env: {
          ...(process.env as Record<string, string>),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          TERM_PROGRAM: "lorien",
        },
      })
    } catch (e) {
      send({ t: "out", d: `\r\nCouldn't start ${shell.label}: ${(e as Error).message}\r\n` })
      ws.close()
      return
    }
    live.add(proc)
    proc.onData((d) => send({ t: "out", d }))
    proc.onExit(({ exitCode }) => {
      live.delete(proc)
      send({ t: "exit", code: exitCode })
      ws.close()
    })
    ws.on("message", (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(String(raw)) as ClientMsg
      } catch {
        return
      }
      if (msg.t === "in" && typeof msg.d === "string") proc.write(msg.d)
      else if (msg.t === "resize")
        proc.resize(size(String(msg.cols), 80), size(String(msg.rows), 24))
    })
    // Closing the tab (or the page) ends its shell.
    ws.on("close", () => {
      if (live.delete(proc)) proc.kill()
    })
  }

  const closeAll = () => {
    for (const p of live) p.kill()
    live.clear()
  }
  server.on("close", closeAll)
  return { closeAll }
}
