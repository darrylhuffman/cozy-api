import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadSavedLayout, STORAGE_KEY, saveLayout, reopenPanel, type PaneId, PANE_IDS, PANE_TITLES } from "./default-layout.js"

describe("loadSavedLayout", () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it("returns null when no layout is saved", () => {
    expect(loadSavedLayout()).toBeNull()
  })

  it("returns null when stored value is malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not-json")
    expect(loadSavedLayout()).toBeNull()
  })

  it("returns null when version mismatches", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, state: {} }))
    expect(loadSavedLayout()).toBeNull()
  })

  it("returns the parsed layout when valid", () => {
    const fake = { version: 1, state: { panels: {} } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fake))
    const out = loadSavedLayout()
    expect(out).toEqual(fake)
  })
})

describe("saveLayout", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("writes the api.toJSON() output under STORAGE_KEY with version 1", () => {
    const fakeJson = { panels: { a: { id: "a" } } }
    const fakeApi = { toJSON: vi.fn(() => fakeJson) } as unknown as Parameters<typeof saveLayout>[0]
    saveLayout(fakeApi)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      version: number
      state: unknown
    }
    expect(stored.version).toBe(1)
    expect(stored.state).toEqual(fakeJson)
  })

  it("does not throw if localStorage is unavailable", () => {
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = vi.fn(() => {
      throw new Error("quota exceeded")
    })
    const fakeApi = { toJSON: vi.fn(() => ({})) } as unknown as Parameters<typeof saveLayout>[0]
    expect(() => saveLayout(fakeApi)).not.toThrow()
    Storage.prototype.setItem = originalSetItem
  })
})

describe("PANE_IDS and PANE_TITLES include agents", () => {
  it("PANE_IDS contains 'agents'", () => {
    expect(PANE_IDS).toContain("agents")
  })
  it("PANE_TITLES.agents is 'Agents'", () => {
    expect(PANE_TITLES.agents).toBe("Agents")
  })
})

describe("reopenPanel for agents", () => {
  it("does not throw when Inspector exists", () => {
    const calls: unknown[] = []
    const api = {
      getPanel: (id: string) => (id === "inspector" ? { id, api: { setActive: () => {} } } : undefined),
      addPanel: (opts: unknown) => calls.push(opts),
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "agents" satisfies PaneId)
    expect(calls).toHaveLength(1)
    const opts = calls[0] as { position?: { referencePanel: string; direction: string } }
    expect(opts.position).toEqual({ referencePanel: "inspector", direction: "within" })
  })

  it("falls back to a new pane on the right when Inspector is absent", () => {
    const calls: unknown[] = []
    const api = {
      getPanel: (id: string) => (id === "code" ? { id, api: { setActive: () => {} } } : undefined),
      addPanel: (opts: unknown) => calls.push(opts),
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "agents" satisfies PaneId)
    expect(calls).toHaveLength(1)
    const opts = calls[0] as { position?: { referencePanel: string; direction: string }; initialWidth?: number }
    expect(opts.position).toEqual({ referencePanel: "code", direction: "right" })
    expect(opts.initialWidth).toBe(400)
  })
})
