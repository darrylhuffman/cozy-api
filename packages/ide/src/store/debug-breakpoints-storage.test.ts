import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  loadBreakpoints,
  saveBreakpoints,
  STORAGE_KEY,
} from "./debug-breakpoints-storage"
import type { Breakpoint } from "@darrylondil/lorien-runtime"

describe("debug-breakpoints-storage", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it("loadBreakpoints returns [] when no entry exists", () => {
    expect(loadBreakpoints()).toEqual([])
  })

  it("round-trips a breakpoint array", () => {
    const bps: Breakpoint[] = [
      { workflowPath: "workflows/a.workflow", nodeId: "n1", kind: "before" },
      { workflowPath: "workflows/b.workflow", nodeId: "n2", kind: "port:foo" },
    ]
    saveBreakpoints(bps)
    expect(loadBreakpoints()).toEqual(bps)
  })

  it("returns [] when localStorage contains malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json")
    expect(loadBreakpoints()).toEqual([])
  })

  it("returns [] when entry is the wrong shape", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }))
    expect(loadBreakpoints()).toEqual([])
  })
})
