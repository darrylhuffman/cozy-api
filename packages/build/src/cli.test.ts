import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { createProgram, isEntryPoint, VERSION } from "./cli.js"

describe("lorien CLI program", () => {
  it("registers all subcommands", () => {
    const program = createProgram()
    const names = program.commands.map((c) => c.name())
    expect(names).toContain("build")
    expect(names).toContain("dev")
    expect(names).toContain("dev:server")
    expect(names).toContain("init")
    expect(names).toContain("import-openapi")
  })

  it("registers the ide subcommand", () => {
    const program = createProgram()
    const names = program.commands.map((c) => c.name())
    expect(names).toContain("ide")
  })

  it("exposes the version", () => {
    expect(VERSION).toBe("0.0.0")
  })

  it("each subcommand has a description", () => {
    const program = createProgram()
    for (const cmd of program.commands) {
      expect(cmd.description().length).toBeGreaterThan(0)
    }
  })
})

describe("isEntryPoint", () => {
  const dir = mkdtempSync(join(tmpdir(), "lorien-cli-"))
  const script = join(dir, "cli.js")
  writeFileSync(script, "")
  const url = pathToFileURL(script).href

  it("matches an absolute script path", () => {
    expect(isEntryPoint(url, script)).toBe(true)
  })

  it("matches a relative script path", () => {
    expect(isEntryPoint(url, relative(process.cwd(), script))).toBe(true)
  })

  it("matches a bin symlink pointing at the script", () => {
    const link = join(dir, "lorien")
    try {
      symlinkSync(script, link)
    } catch {
      return // symlinks need elevated rights on some Windows setups
    }
    expect(isEntryPoint(url, link)).toBe(true)
  })

  it("is false for a different script or none", () => {
    expect(isEntryPoint(url, join(dir, "missing.js"))).toBe(false)
    expect(isEntryPoint(url, undefined)).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
})
