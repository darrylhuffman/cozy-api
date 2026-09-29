import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import {
  COALESCE_MS,
  HISTORY_LIMIT,
  isDraftDirty,
  serializeWorkflow,
  useWorkflowDrafts,
} from "./workflow-drafts"

const TAB = "tab-1"
const PATH = "workflows/a.workflow"

function wf(label: string): WorkflowFile {
  return { lorien: 1, nodes: { a: { uses: "./a", label } } }
}

const store = () => useWorkflowDrafts.getState()
const draft = () => store().drafts[TAB]!

beforeEach(() => {
  useWorkflowDrafts.setState({ drafts: {} })
  store().load(TAB, PATH, wf("v0"))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("useWorkflowDrafts", () => {
  it("load seeds a clean draft with empty history", () => {
    expect(draft().workflow).toEqual(wf("v0"))
    expect(draft().baseline).toBe(serializeWorkflow(wf("v0")))
    expect(isDraftDirty(draft())).toBe(false)
    expect(draft().past).toEqual([])
  })

  it("apply records history and makes the draft dirty", () => {
    store().apply(TAB, wf("v1"))
    expect(draft().workflow).toEqual(wf("v1"))
    expect(draft().past).toEqual([wf("v0")])
    expect(isDraftDirty(draft())).toBe(true)
  })

  it("undo / redo walk the history; undoing to the baseline is clean", () => {
    store().apply(TAB, wf("v1"))
    store().apply(TAB, wf("v2"))
    expect(store().undo(TAB)).toBe(true)
    expect(draft().workflow).toEqual(wf("v1"))
    expect(store().undo(TAB)).toBe(true)
    expect(isDraftDirty(draft())).toBe(false)
    expect(store().undo(TAB)).toBe(false)
    expect(store().redo(TAB)).toBe(true)
    expect(store().redo(TAB)).toBe(true)
    expect(draft().workflow).toEqual(wf("v2"))
    expect(store().redo(TAB)).toBe(false)
  })

  it("a new edit clears the redo stack", () => {
    store().apply(TAB, wf("v1"))
    store().undo(TAB)
    store().apply(TAB, wf("v1b"))
    expect(draft().future).toEqual([])
    expect(store().redo(TAB)).toBe(false)
  })

  it("coalesces edits sharing a key inside the window", () => {
    vi.useFakeTimers()
    store().apply(TAB, wf("t"), { coalesceKey: "k" })
    vi.advanceTimersByTime(100)
    store().apply(TAB, wf("ty"), { coalesceKey: "k" })
    store().apply(TAB, wf("typ"), { coalesceKey: "k" })
    expect(draft().past).toEqual([wf("v0")])
    vi.advanceTimersByTime(COALESCE_MS + 1)
    store().apply(TAB, wf("type"), { coalesceKey: "k" })
    expect(draft().past).toEqual([wf("v0"), wf("typ")])
  })

  it("does not coalesce edits with different keys", () => {
    store().apply(TAB, wf("a"), { coalesceKey: "x" })
    store().apply(TAB, wf("b"), { coalesceKey: "y" })
    expect(draft().past).toHaveLength(2)
  })

  it("caps history at HISTORY_LIMIT", () => {
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) store().apply(TAB, wf(`v${i}`))
    expect(draft().past).toHaveLength(HISTORY_LIMIT)
  })

  it("markSaved moves the baseline without touching history", () => {
    store().apply(TAB, wf("v1"))
    store().markSaved(TAB, wf("v1"))
    expect(isDraftDirty(draft())).toBe(false)
    expect(draft().past).toEqual([wf("v0")])
  })

  it("markSaved keeps edits made while the save was in flight", () => {
    store().apply(TAB, wf("v1"))
    const source = draft().workflow
    store().apply(TAB, wf("v2"))
    store().markSaved(TAB, wf("v1"), source)
    expect(draft().workflow).toEqual(wf("v2"))
    expect(isDraftDirty(draft())).toBe(true)
  })

  it("externalChange on a clean draft adopts the disk content as an undoable step", () => {
    store().externalChange(TAB, wf("disk"))
    expect(draft().workflow).toEqual(wf("disk"))
    expect(isDraftDirty(draft())).toBe(false)
    store().undo(TAB)
    expect(draft().workflow).toEqual(wf("v0"))
  })

  it("externalChange on a dirty draft records a conflict and keeps local edits", () => {
    store().apply(TAB, wf("mine"))
    store().externalChange(TAB, wf("disk"))
    expect(draft().workflow).toEqual(wf("mine"))
    expect(draft().diskConflict).toEqual(wf("disk"))
  })

  it("externalChange matching the baseline (own save echo) is a no-op", () => {
    store().apply(TAB, wf("v1"))
    store().markSaved(TAB, wf("v1"))
    const before = draft()
    store().externalChange(TAB, wf("v1"))
    expect(draft()).toBe(before)
  })

  it("externalChange matching the local edits just moves the baseline", () => {
    store().apply(TAB, wf("same"))
    store().externalChange(TAB, wf("same"))
    expect(draft().diskConflict).toBeNull()
    expect(isDraftDirty(draft())).toBe(false)
  })

  it("resolveConflict('disk') takes the disk copy, undoable", () => {
    store().apply(TAB, wf("mine"))
    store().externalChange(TAB, wf("disk"))
    store().resolveConflict(TAB, "disk")
    expect(draft().workflow).toEqual(wf("disk"))
    expect(draft().diskConflict).toBeNull()
    expect(isDraftDirty(draft())).toBe(false)
    store().undo(TAB)
    expect(draft().workflow).toEqual(wf("mine"))
  })

  it("resolveConflict('mine') keeps local edits and stays dirty against the disk copy", () => {
    store().apply(TAB, wf("mine"))
    store().externalChange(TAB, wf("disk"))
    store().resolveConflict(TAB, "mine")
    expect(draft().workflow).toEqual(wf("mine"))
    expect(draft().baseline).toBe(serializeWorkflow(wf("disk")))
    expect(isDraftDirty(draft())).toBe(true)
  })

  it("drop removes the draft; operations on unknown tabs are no-ops", () => {
    store().drop(TAB)
    expect(store().drafts[TAB]).toBeUndefined()
    expect(store().undo(TAB)).toBe(false)
    store().apply(TAB, wf("x"))
    expect(store().drafts[TAB]).toBeUndefined()
  })
})
