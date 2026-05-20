import type { DockviewApi } from "dockview-react"
import { create } from "zustand"

interface DockviewApiState {
  api: DockviewApi | null
  setApi(api: DockviewApi): void
}

export const useDockviewApi = create<DockviewApiState>((set) => ({
  api: null,
  setApi: (api) => set({ api }),
}))
