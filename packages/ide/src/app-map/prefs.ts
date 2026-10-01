import { create } from "zustand"
import { persist } from "zustand/middleware"

export type MapView = "lanes" | "graph"

interface AppMapPrefs {
  view: MapView
  /** One bubble per folder of workflows or nodes. */
  group: boolean
  /** Folder outlines, per layout: they suit Lanes, and get busy in Graph. */
  outlines: Record<MapView, boolean>
  setView(view: MapView): void
  setGroup(group: boolean): void
  setOutlines(view: MapView, on: boolean): void
}

/** How the Application map is shown, remembered between sessions. */
export const useAppMapPrefs = create<AppMapPrefs>()(
  persist(
    (set) => ({
      view: "lanes",
      group: false,
      outlines: { lanes: true, graph: false },
      setView: (view) => set({ view }),
      setGroup: (group) => set({ group }),
      setOutlines: (view, on) => set((s) => ({ outlines: { ...s.outlines, [view]: on } })),
    }),
    { name: "lorien-ide-app-map", version: 1 },
  ),
)
