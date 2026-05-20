import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadSavedLayout, STORAGE_KEY, saveLayout } from "./default-layout.js"

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
