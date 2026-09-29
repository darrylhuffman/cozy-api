import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { useDockviewApi } from "@/store/dockview-api"
import { openCodeFile } from "./open-code-file.js"

// Mock dockview API
const mockSetActive = vi.fn()
const mockGetPanel = vi.fn()

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
  mockSetActive.mockReset()
  mockGetPanel.mockReset()
  mockGetPanel.mockReturnValue({ api: { setActive: mockSetActive } })
  useDockviewApi.setState({ api: { getPanel: mockGetPanel } as never })
})

afterEach(() => {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
  useDockviewApi.setState({ api: null })
  vi.clearAllMocks()
})

describe("openCodeFile", () => {
  it("calls openTab with id=path, title=filename, kind='node', path=path", () => {
    openCodeFile("nodes/users/save-user.ts")

    const tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      id: "nodes/users/save-user.ts",
      title: "save-user.ts",
      kind: "node",
      path: "nodes/users/save-user.ts",
    })
    expect(useTabsStore.getState().activeCodeId).toBe("nodes/users/save-user.ts")
  })

  it("focuses the 'code' dockview panel", () => {
    openCodeFile("nodes/users/save-user.ts")

    expect(mockGetPanel).toHaveBeenCalledWith("code")
    expect(mockSetActive).toHaveBeenCalledOnce()
  })

  it("does not create a duplicate tab when called twice with the same path", () => {
    openCodeFile("nodes/shared/parseBody.ts")
    openCodeFile("nodes/shared/parseBody.ts")

    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().activeCodeId).toBe("nodes/shared/parseBody.ts")
  })

  it("uses the last path segment as the title", () => {
    openCodeFile("nodes/deeply/nested/util.ts")

    const tab = useTabsStore.getState().tabs[0]
    expect(tab?.title).toBe("util.ts")
  })

  it("falls back gracefully when the dockview api is null", () => {
    useDockviewApi.setState({ api: null })

    // Should not throw
    expect(() => openCodeFile("nodes/foo.ts")).not.toThrow()
    expect(useTabsStore.getState().tabs).toHaveLength(1)
  })
})
