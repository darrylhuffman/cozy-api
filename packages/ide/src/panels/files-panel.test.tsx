import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { FilesPanel } from "./files-panel.js"

beforeEach(() => {
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeId: null })
})
afterEach(() => {
  cleanup()
})

describe("FilesPanel", () => {
  it("renders the WORKFLOWS and NODES section headers", () => {
    render(<FilesPanel />)
    expect(screen.getByText("WORKFLOWS")).toBeInTheDocument()
    expect(screen.getByText("NODES")).toBeInTheDocument()
  })

  it("clicking a file leaf opens it as a tab", () => {
    render(<FilesPanel />)
    // Expand the "shared" subfolder first (it's collapsed by default)
    fireEvent.click(screen.getByText("shared"))
    const link = screen.getByText("parseBody.ts")
    fireEvent.click(link)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().tabs[0]?.id).toBe("n-shared-parseBody")
    expect(useTabsStore.getState().activeId).toBe("n-shared-parseBody")
  })
})
