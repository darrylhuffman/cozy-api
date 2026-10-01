import { create } from "zustand"

interface SelectionState {
  /** The node the Inspector shows: the one clicked last. */
  selectedNodeId: string | null
  /** Every node selected on the canvas, the primary one included. */
  selectedNodeIds: string[]
  /** Selects one node (or none). */
  setSelected: (id: string | null) => void
  /**
   * Selects several nodes. The primary node stays primary while it is still
   * selected; otherwise it becomes `primary`, or the last id.
   */
  setSelection: (ids: string[], primary?: string | null) => void
}

const EMPTY: string[] = []

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedNodeId: null,
  selectedNodeIds: EMPTY,
  setSelected: (id) => set({ selectedNodeId: id, selectedNodeIds: id ? [id] : EMPTY }),
  setSelection: (ids, primary) =>
    set((s) => {
      const unique = [...new Set(ids)]
      const nextPrimary =
        primary !== undefined && (primary === null || unique.includes(primary))
          ? primary
          : s.selectedNodeId && unique.includes(s.selectedNodeId)
            ? s.selectedNodeId
            : (unique.at(-1) ?? null)
      const same =
        nextPrimary === s.selectedNodeId &&
        unique.length === s.selectedNodeIds.length &&
        unique.every((id) => s.selectedNodeIds.includes(id))
      if (same) return s
      return { selectedNodeId: nextPrimary, selectedNodeIds: unique.length ? unique : EMPTY }
    }),
}))
