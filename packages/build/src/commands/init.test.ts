import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { runInit } from "./init.js"

describe("runInit", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-init-"))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it("writes AGENTS.md when none exists", async () => {
    const result = await runInit({ root: dir, force: false })
    expect(result.ok).toBe(true)
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8")
    expect(content).toMatch(/lorien/)
    expect(content).toMatch(/defineNode/)
  })

  it("refuses to overwrite when AGENTS.md exists without --force", async () => {
    writeFileSync(join(dir, "AGENTS.md"), "PRE-EXISTING")
    const result = await runInit({ root: dir, force: false })
    expect(result.ok).toBe(false)
    expect(result.error).toBe("exists")
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe("PRE-EXISTING")
  })

  it("overwrites with --force", async () => {
    writeFileSync(join(dir, "AGENTS.md"), "PRE-EXISTING")
    const result = await runInit({ root: dir, force: true })
    expect(result.ok).toBe(true)
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).not.toBe("PRE-EXISTING")
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toMatch(/lorien/)
  })

  it("writes the same guide create-lorien scaffolds, plus the Claude Code skill", async () => {
    const { renderAgentsMd } = await import("create-lorien/templates")
    await runInit({ root: dir, force: false })
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe(renderAgentsMd())
    expect(readFileSync(join(dir, ".claude/skills/lorien-api/SKILL.md"), "utf-8")).toMatch(
      /^---\nname: lorien-api/,
    )
  })
})
