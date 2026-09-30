import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { Hono } from "hono"
import { afterEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { attachTerminal, detectShells, mountTerminalRoutes, type ServerMsg } from "./terminal.js"

describe("detectShells", () => {
  it("offers PowerShell and Command Prompt on Windows, PowerShell 7 and Git Bash when installed", () => {
    const env = { SystemRoot: "C:\\Windows", ComSpec: "C:\\Windows\\system32\\cmd.exe" }
    expect(detectShells("win32", env, () => false).map((s) => s.id)).toEqual(["powershell", "cmd"])
    const all = detectShells("win32", env, () => true)
    expect(all.map((s) => s.label)).toEqual([
      "PowerShell 7",
      "PowerShell",
      "Command Prompt",
      "Git Bash",
    ])
    expect(all[2]?.path).toBe("C:\\Windows\\system32\\cmd.exe")
  })

  it("starts with the user's login shell on macOS and Linux, then others that exist", () => {
    const have = new Set(["/usr/local/bin/fish", "/bin/zsh", "/bin/bash", "/bin/sh"])
    const shells = detectShells("darwin", { SHELL: "/usr/local/bin/fish" }, (p) => have.has(p))
    expect(shells.map((s) => s.path)).toEqual([
      "/usr/local/bin/fish",
      "/bin/zsh",
      "/bin/bash",
      "/bin/sh",
    ])
    expect(shells[0]?.args).toEqual(["-l"])
    expect(shells.at(-1)?.args).toEqual([])
  })

  it("defaults to zsh on macOS and bash on Linux without $SHELL", () => {
    const have = new Set(["/bin/zsh", "/bin/bash"])
    expect(detectShells("darwin", {}, (p) => have.has(p))[0]?.id).toBe("zsh")
    expect(detectShells("linux", {}, (p) => have.has(p))[0]?.id).toBe("bash")
  })
})

describe("the terminal server", () => {
  let server: Server | null = null
  afterEach(async () => {
    const s = server
    server = null
    if (!s) return
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  })

  const info = async (headers: Record<string, string> = {}) => {
    const app = new Hono()
    mountTerminalRoutes(app, tmpdir())
    return app.request("/api/terminal/info", { headers })
  }

  it("hands its token only to a page on localhost", async () => {
    const ok = await info({ origin: "http://localhost:3737" })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { available: boolean; token: string; shells: unknown[] }
    expect(body.available).toBe(true)
    expect(body.token).toMatch(/^[0-9a-f]{48}$/)
    expect(body.shells.length).toBeGreaterThan(0)
    expect((await info({ origin: "https://evil.example" })).status).toBe(403)
  })

  const listen = async () => {
    server = createServer()
    attachTerminal(server, tmpdir())
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r))
    return (server.address() as AddressInfo).port
  }

  const token = async () => ((await (await info()).json()) as { token: string }).token

  it("refuses a socket without the token or from another site", async () => {
    const port = await listen()
    const t = await token()
    const status = (url: string, origin: string) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(url, { origin })
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0))
        ws.on("open", () => {
          ws.close()
          resolve(101)
        })
      })
    const base = `ws://127.0.0.1:${port}/api/terminal/socket`
    expect(await status(`${base}?token=nope`, "http://localhost:3737")).toBe(403)
    expect(await status(`${base}?token=${t}`, "https://evil.example")).toBe(403)
  })

  it("runs a shell in the project folder and streams its output", async () => {
    const port = await listen()
    const ws = new WebSocket(
      `ws://127.0.0.1:${port}/api/terminal/socket?token=${await token()}&cols=100&rows=30`,
      { origin: "http://localhost:3737" },
    )
    let out = ""
    const exit = new Promise<number>((resolve) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as ServerMsg
        if (msg.t === "out") out += msg.d
        else resolve(msg.code)
      })
    })
    await new Promise((r) => ws.on("open", r))
    ws.send(JSON.stringify({ t: "in", d: "echo lorien-$((1+1)) && exit 3\r" }))
    expect(await exit).toBe(3)
    expect(out).toContain("lorien-2")
  }, 20_000)
})
