import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useTabsStore } from "./tabs.js"

const sample = { id: "f1", title: "A.workflow", kind: "workflow" as const }
const sample2 = { id: "f2", title: "B.workflow", kind: "workflow" as const }

beforeEach(() => {
  localStorage.clear()
  // Reset store
  useTabsStore.setState({ tabs: [], activeId: null })
})
afterEach(() => {
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeId: null })
})

describe("useTabsStore", () => {
  it("starts empty", () => {
    expect(useTabsStore.getState().tabs).toEqual([])
    expect(useTabsStore.getState().activeId).toBeNull()
  })

  it("openTab adds a tab and activates it", () => {
    useTabsStore.getState().openTab(sample)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().activeId).toBe("f1")
  })

  it("openTab on an existing tab just re-activates it (no duplicate)", () => {
    useTabsStore.getState().openTab(sample)
    useTabsStore.getState().openTab(sample2)
    useTabsStore.getState().openTab(sample)
    expect(useTabsStore.getState().tabs).toHaveLength(2)
    expect(useTabsStore.getState().activeId).toBe("f1")
  })

  it("selectTab activates an existing tab", () => {
    useTabsStore.getState().openTab(sample)
    useTabsStore.getState().openTab(sample2)
    useTabsStore.getState().selectTab("f1")
    expect(useTabsStore.getState().activeId).toBe("f1")
  })

  it("selectTab on a missing tab is a no-op", () => {
    useTabsStore.getState().openTab(sample)
    useTabsStore.getState().selectTab("does-not-exist")
    expect(useTabsStore.getState().activeId).toBe("f1")
  })

  it("closeTab removes the tab and picks a replacement when closing the active tab", () => {
    useTabsStore.getState().openTab(sample)
    useTabsStore.getState().openTab(sample2)
    useTabsStore.getState().closeTab("f2")
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().activeId).toBe("f1")
  })

  it("closeTab on the last tab leaves activeId null", () => {
    useTabsStore.getState().openTab(sample)
    useTabsStore.getState().closeTab("f1")
    expect(useTabsStore.getState().tabs).toEqual([])
    expect(useTabsStore.getState().activeId).toBeNull()
  })
})
