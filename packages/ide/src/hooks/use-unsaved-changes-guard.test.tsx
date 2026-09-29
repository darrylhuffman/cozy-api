import { cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard"

function fireBeforeUnload(): Event {
  const e = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(e)
  return e
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
})
afterEach(() => {
  cleanup()
})

describe("useUnsavedChangesGuard", () => {
  it("lets the page unload when nothing is dirty", () => {
    renderHook(() => useUnsavedChangesGuard())
    useTabsStore.getState().openTab({ id: "a", title: "a", kind: "workflow", path: "a" })
    expect(fireBeforeUnload().defaultPrevented).toBe(false)
  })

  it("asks for confirmation while any tab is dirty", () => {
    renderHook(() => useUnsavedChangesGuard())
    useTabsStore.getState().openTab({ id: "a", title: "a", kind: "node", path: "a.ts" })
    useTabsStore.getState().setDirty("a", true)
    expect(fireBeforeUnload().defaultPrevented).toBe(true)
  })

  it("stops guarding once unmounted", () => {
    const { unmount } = renderHook(() => useUnsavedChangesGuard())
    useTabsStore.getState().openTab({ id: "a", title: "a", kind: "workflow", path: "a" })
    useTabsStore.getState().setDirty("a", true)
    unmount()
    expect(fireBeforeUnload().defaultPrevented).toBe(false)
  })
})
