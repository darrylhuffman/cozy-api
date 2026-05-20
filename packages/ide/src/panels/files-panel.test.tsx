import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { FilesPanel } from "./files-panel.js"

// Simulate backend being unavailable so the component falls back to mock data
beforeEach(() => {
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
  // fetch will reject — component falls back to mock data
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch not available in tests")))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FilesPanel", () => {
  it("renders the WORKFLOWS and NODES section headers (fallback mode)", async () => {
    render(<FilesPanel />)
    // Wait for the async fetch to reject and the component to fall back to mock data
    await waitFor(() => {
      expect(screen.getByText("WORKFLOWS")).toBeInTheDocument()
      expect(screen.getByText("NODES")).toBeInTheDocument()
    })
  })

  it("clicking a file leaf opens it as a tab", async () => {
    render(<FilesPanel />)
    // Wait for fallback state (mock data visible)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())

    // Expand the "shared" subfolder first (it's collapsed by default)
    fireEvent.click(screen.getByText("shared"))
    const link = screen.getByText("parseBody.ts")
    fireEvent.click(link)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().tabs[0]?.id).toBe("n-shared-parseBody")
    expect(useTabsStore.getState().activeCodeId).toBe("n-shared-parseBody")
  })
})
