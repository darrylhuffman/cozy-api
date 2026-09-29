import { create } from "zustand"

interface SelectionState {
  selectedNodeId: string | null
  setSelected: (id: string | null) => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedNodeId: null,
  setSelected: (id) => set({ selectedNodeId: id }),
}))
