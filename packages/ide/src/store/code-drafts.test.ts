import { beforeEach, describe, expect, it } from "vitest"
import { isCodeDraftDirty, useCodeDrafts } from "./code-drafts"

const store = () => useCodeDrafts.getState()
const draft = () => store().drafts.t!

beforeEach(() => {
  useCodeDrafts.setState({ drafts: {} })
  store().load("t", "nodes/a.ts", "v0")
})

describe("useCodeDrafts", () => {
  it("edit makes the draft dirty; editing back to the baseline makes it clean", () => {
    store().edit("t", "v1")
    expect(isCodeDraftDirty(draft())).toBe(true)
    store().edit("t", "v0")
    expect(isCodeDraftDirty(draft())).toBe(false)
  })

  it("markSaved moves the baseline", () => {
    store().edit("t", "v1")
    store().markSaved("t", "v1")
    expect(isCodeDraftDirty(draft())).toBe(false)
  })

  it("externalChange adopts disk text when clean and flags a conflict when dirty", () => {
    store().externalChange("t", "disk")
    expect(draft().content).toBe("disk")
    store().edit("t", "mine")
    store().externalChange("t", "disk2")
    expect(draft().content).toBe("mine")
    expect(draft().diskConflict).toBe("disk2")
  })

  it("resolveConflict keeps either side", () => {
    store().edit("t", "mine")
    store().externalChange("t", "disk")
    store().resolveConflict("t", "mine")
    expect(draft().content).toBe("mine")
    expect(isCodeDraftDirty(draft())).toBe(true)
    store().externalChange("t", "disk2")
    store().resolveConflict("t", "disk")
    expect(draft().content).toBe("disk2")
    expect(isCodeDraftDirty(draft())).toBe(false)
  })

  it("drop forgets the draft", () => {
    store().drop("t")
    expect(store().drafts.t).toBeUndefined()
  })
})
