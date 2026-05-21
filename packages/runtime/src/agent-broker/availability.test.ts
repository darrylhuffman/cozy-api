import { describe, expect, it, vi } from "vitest"
import {
  AvailabilityProbe,
  type ProbeExec,
} from "./availability.js"

describe("AvailabilityProbe", () => {
  it("reports installed=true and a version when the CLI exits 0", async () => {
    const exec: ProbeExec = vi.fn(async (cmd) => {
      if (cmd === "claude")
        return { exitCode: 0, stdout: "claude-code 1.2.3\n", stderr: "" }
      return { exitCode: 127, stdout: "", stderr: "not found" }
    })
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.installed).toBe(true)
    expect(av.claude.version).toBe("1.2.3")
    expect(av.codex.installed).toBe(false)
  })

  it("strips ANSI / leading-whitespace from version output", async () => {
    const exec: ProbeExec = vi.fn(async () => ({
      exitCode: 0,
      stdout: "  Claude Code v 4.5.6 (build abc)\n",
      stderr: "",
    }))
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.version).toBe("4.5.6")
  })

  it("returns installed=false when the CLI exits non-zero", async () => {
    const exec: ProbeExec = vi.fn(async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "command not found",
    }))
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.installed).toBe(false)
    expect(av.codex.installed).toBe(false)
  })

  it("caches the result for 30s and re-probes after", async () => {
    let calls = 0
    const exec: ProbeExec = vi.fn(async () => {
      calls++
      return { exitCode: 0, stdout: "claude 9.9.9", stderr: "" }
    })
    let nowValue = 0
    const probe = new AvailabilityProbe({ exec, now: () => nowValue })
    await probe.probe()
    await probe.probe()
    await probe.probe()
    expect(calls).toBe(2) // two binaries probed once each
    nowValue = 25_000
    await probe.probe()
    expect(calls).toBe(2) // still cached
    nowValue = 31_000
    await probe.probe()
    expect(calls).toBe(4) // both re-probed
  })

  it("treats exec rejection (ENOENT etc.) as not installed", async () => {
    const exec: ProbeExec = vi.fn(async () => {
      throw new Error("ENOENT")
    })
    const probe = new AvailabilityProbe({ exec, now: () => 0 })
    const av = await probe.probe()
    expect(av.claude.installed).toBe(false)
  })
})
