import { afterEach, describe, expect, it } from "vitest"
import { useSelectionStore } from "./selection"

describe("useSelectionStore", () => {
  afterEach(() => {
    useSelectionStore.setState({ selectedNodeId: null })
  })

  it("starts with no selection", () => {
    expect(useSelectionStore.getState().selectedNodeId).toBeNull()
  })

  it("setSelected stores the id", () => {
    useSelectionStore.getState().setSelected("save")
    expect(useSelectionStore.getState().selectedNodeId).toBe("save")
  })

  it("setSelected(null) clears", () => {
    useSelectionStore.getState().setSelected("save")
    useSelectionStore.getState().setSelected(null)
    expect(useSelectionStore.getState().selectedNodeId).toBeNull()
  })
})
