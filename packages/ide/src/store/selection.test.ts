import { afterEach, describe, expect, it } from "vitest"
import { useSelectionStore } from "./selection"

describe("useSelectionStore", () => {
  afterEach(() => {
    useSelectionStore.setState({ selectedNodeId: null, selectedNodeIds: [] })
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

  it("setSelected keeps the list to that one node", () => {
    useSelectionStore.getState().setSelection(["a", "b"])
    useSelectionStore.getState().setSelected("c")
    expect(useSelectionStore.getState().selectedNodeIds).toEqual(["c"])
  })

  it("setSelection keeps the primary node while it stays selected", () => {
    useSelectionStore.getState().setSelected("a")
    useSelectionStore.getState().setSelection(["a", "b", "b"])
    expect(useSelectionStore.getState()).toMatchObject({
      selectedNodeId: "a",
      selectedNodeIds: ["a", "b"],
    })
  })

  it("setSelection picks the last node, or the one asked for, when the primary drops out", () => {
    useSelectionStore.getState().setSelected("a")
    useSelectionStore.getState().setSelection(["b", "c"])
    expect(useSelectionStore.getState().selectedNodeId).toBe("c")
    useSelectionStore.getState().setSelection(["b", "c"], "b")
    expect(useSelectionStore.getState().selectedNodeId).toBe("b")
    useSelectionStore.getState().setSelection([])
    expect(useSelectionStore.getState().selectedNodeId).toBeNull()
  })

  it("setSelection leaves the state alone when nothing changed", () => {
    useSelectionStore.getState().setSelection(["a", "b"])
    const before = useSelectionStore.getState()
    useSelectionStore.getState().setSelection(["b", "a"])
    expect(useSelectionStore.getState()).toBe(before)
  })
})
