import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildDefaultLayout,
  loadSavedLayout,
  PANE_IDS,
  PANE_TITLES,
  type PaneId,
  reopenPanel,
  STORAGE_KEY,
  saveLayout,
} from "./default-layout.js"

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
    const fake = { version: 2, state: { panels: {} } }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fake))
    const out = loadSavedLayout()
    expect(out).toEqual(fake)
  })
})

describe("saveLayout", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("writes the api.toJSON() output under STORAGE_KEY with the current version", () => {
    const fakeJson = { panels: { a: { id: "a" } } }
    const fakeApi = { toJSON: vi.fn(() => fakeJson) } as unknown as Parameters<typeof saveLayout>[0]
    saveLayout(fakeApi)
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as {
      version: number
      state: unknown
    }
    expect(stored.version).toBe(2)
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

describe("PANE_IDS and PANE_TITLES", () => {
  it("has one editor pane and Agents as its own pane", () => {
    expect([...PANE_IDS].sort()).toEqual(["agents", "debug", "editor", "files", "inspector"])
    expect(PANE_TITLES.agents).toBe("Agents")
    expect(PANE_TITLES.files).toBe("Explorer")
    expect(PANE_TITLES.editor).toBe("Editor")
  })
})

describe("reopenPanel", () => {
  it("puts the Inspector to the right of the editor", () => {
    const calls: unknown[] = []
    const api = {
      getPanel: (id: string) =>
        id === "editor" ? { id, api: { setActive: () => {} } } : undefined,
      addPanel: (opts: unknown) => calls.push(opts),
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "inspector" satisfies PaneId)
    expect(calls).toHaveLength(1)
    const opts = calls[0] as {
      position?: { referencePanel: string; direction: string }
      initialWidth?: number
    }
    expect(opts.position).toEqual({ referencePanel: "editor", direction: "right" })
    expect(opts.initialWidth).toBe(380)
  })

  it("opens Agents between the editor and the Inspector", () => {
    const calls: unknown[] = []
    const api = {
      getPanel: (id: string) =>
        id === "inspector" || id === "editor"
          ? { id, api: { setActive: () => {}, setSize: () => {} } }
          : undefined,
      addPanel: (opts: unknown) => calls.push(opts),
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "agents")
    const opts = calls[0] as { position?: { referencePanel: string; direction: string } }
    expect(opts.position).toEqual({ referencePanel: "editor", direction: "right" })
  })

  it("puts Debug below the editor", () => {
    const calls: unknown[] = []
    const api = {
      getPanel: (id: string) =>
        id === "editor" ? { id, api: { setActive: () => {} } } : undefined,
      addPanel: (opts: unknown) => calls.push(opts),
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "debug" satisfies PaneId)
    const opts = calls[0] as { position?: { referencePanel: string; direction: string } }
    expect(opts.position).toEqual({ referencePanel: "editor", direction: "below" })
  })

  it("does nothing when the pane is already open", () => {
    const addPanel = vi.fn()
    const api = {
      getPanel: () => ({ id: "files", api: { setActive: () => {} } }),
      addPanel,
    } as unknown as Parameters<typeof reopenPanel>[0]
    reopenPanel(api, "files")
    expect(addPanel).not.toHaveBeenCalled()
  })
})

describe("buildDefaultLayout", () => {
  it("lays out Explorer, editor, Inspector and Debug and sizes the edges", () => {
    const log: string[] = []
    const added = new Set<string>()
    const api = {
      addPanel: (opts: { id: string }) => added.add(opts.id),
      getPanel: (id: string) =>
        added.has(id)
          ? {
              id,
              api: {
                setActive: () => log.push(`active:${id}`),
                setSize: (s: { width?: number; height?: number }) =>
                  log.push(`size:${id}:${s.width ?? s.height}`),
              },
            }
          : undefined,
    } as unknown as Parameters<typeof buildDefaultLayout>[0]
    buildDefaultLayout(api)
    expect([...added]).toEqual(["files", "editor", "inspector", "debug"])
    expect(log).toEqual(["size:files:248", "size:inspector:380", "size:debug:240", "active:editor"])
  })
})
