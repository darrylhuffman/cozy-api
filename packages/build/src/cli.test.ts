import { describe, expect, it } from "vitest"
import { createProgram, VERSION } from "./cli.js"

describe("cozy CLI program", () => {
  it("registers all four subcommands", () => {
    const program = createProgram()
    const names = program.commands.map((c) => c.name())
    expect(names).toContain("build")
    expect(names).toContain("dev")
    expect(names).toContain("init")
    expect(names).toContain("import-openapi")
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
