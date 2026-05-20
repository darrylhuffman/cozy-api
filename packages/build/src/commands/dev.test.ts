import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runDev } from "./dev.js"

describe("runDev", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cozy-dev-"))
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
    expect(callArgs[1]).toEqual([join(dir, "src", "server.ts")])
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
