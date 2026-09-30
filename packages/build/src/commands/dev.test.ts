import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runDev, runDevWithIde } from "./dev.js"

describe("runDev", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-dev-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("errors when src/server.ts is missing", async () => {
    const result = await runDev({ root: dir })
    expect(result.exitCode).toBe(1)
    expect(result.error).toBe("entry-not-found")
  })

  it("spawns tsx with the resolved entry path when src/server.ts exists", async () => {
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "server.ts"), "console.log('test')")

    const fakeChild = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "close") setTimeout(() => cb(0), 5)
        return this
      },
    }
    const spawnImpl = vi.fn(() => fakeChild as never)
    const result = await runDev({ root: dir, spawnImpl })

    expect(spawnImpl).toHaveBeenCalledOnce()
    const callArgs = spawnImpl.mock.calls[0]!
    expect(callArgs[0]).toBe("tsx")
    expect(callArgs[1]).toEqual([
      "watch",
      "--clear-screen=false",
      "--include",
      "workflows/**/*.workflow",
      join(dir, "src", "server.ts"),
    ])
    expect(callArgs[2].env.PORT).toMatch(/^\d+$/)
    expect(result.exitCode).toBe(0)
  })

  it("passes the requested available port through PORT", async () => {
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "server.ts"), "console.log('test')")

    const fakeChild = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "close") setTimeout(() => cb(0), 5)
        return this
      },
    }
    const spawnImpl = vi.fn(() => fakeChild as never)
    const result = await runDev({ root: dir, port: 43210, spawnImpl })

    expect(spawnImpl).toHaveBeenCalledOnce()
    expect(spawnImpl.mock.calls[0]![2].env.PORT).toBe("43210")
    expect(result.exitCode).toBe(0)
  })

  it("propagates spawn errors via 'error' event", async () => {
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "server.ts"), "")

    const fakeChild = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "error") setTimeout(() => cb(new Error("ENOENT: tsx")), 5)
        return this
      },
    }
    const spawnImpl = vi.fn(() => fakeChild as never)
    const result = await runDev({ root: dir, spawnImpl })

    expect(result.exitCode).toBe(1)
    expect(result.error).toMatch(/tsx/)
  })
})

describe("runDevWithIde", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-dev-ide-"))
    mkdirSync(join(dir, "src"))
    writeFileSync(join(dir, "src", "server.ts"), "")
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("starts the IDE on the same project root as the API server", async () => {
    const runIdeImpl = vi.fn().mockResolvedValue({ port: 8188, root: "dist" })
    const fakeChild = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "close") setTimeout(() => cb(0), 5)
        return this
      },
    }
    const spawnImpl = vi.fn(() => fakeChild as never)
    const result = await runDevWithIde({ root: dir, idePort: 8188, spawnImpl, runIdeImpl })
    expect(runIdeImpl).toHaveBeenCalledWith({ port: 8188, open: true, root: dir })
    expect(spawnImpl.mock.calls[0]![2].cwd).toBe(dir)
    expect(result.exitCode).toBe(0)
  })

  it("falls back to the dev server alone when the IDE cannot start", async () => {
    const runIdeImpl = vi.fn().mockRejectedValue(new Error("dist missing"))
    const fakeChild = {
      on(event: string, cb: (...args: unknown[]) => void) {
        if (event === "close") setTimeout(() => cb(0), 5)
        return this
      },
    }
    const spawnImpl = vi.fn(() => fakeChild as never)
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await runDevWithIde({ root: dir, idePort: 8188, spawnImpl, runIdeImpl })
    expect(spawnImpl).toHaveBeenCalledOnce()
    expect(result.exitCode).toBe(0)
    errSpy.mockRestore()
  })
})
