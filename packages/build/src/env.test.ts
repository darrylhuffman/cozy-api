import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadProjectEnv } from "./env.js"

describe("loadProjectEnv", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-env-"))
    delete process.env.LORIEN_ENV_TEST_A
    process.env.LORIEN_ENV_TEST_B = "from-shell"
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.LORIEN_ENV_TEST_A
    delete process.env.LORIEN_ENV_TEST_B
  })

  it("loads .env without overriding variables the shell already set", () => {
    writeFileSync(join(dir, ".env"), "LORIEN_ENV_TEST_A=from-file\nLORIEN_ENV_TEST_B=from-file\n")
    expect(loadProjectEnv(dir)).toBe(true)
    expect(process.env.LORIEN_ENV_TEST_A).toBe("from-file")
    expect(process.env.LORIEN_ENV_TEST_B).toBe("from-shell")
  })

  it("does nothing without a .env", () => {
    expect(loadProjectEnv(dir)).toBe(false)
    expect(process.env.LORIEN_ENV_TEST_A).toBeUndefined()
  })
})
