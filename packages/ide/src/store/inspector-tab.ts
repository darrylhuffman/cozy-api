import { create } from "zustand"

export type InspectorTab = "inspect" | "tests" | "run"

interface InspectorTabState {
  tab: InspectorTab
  setTab(tab: InspectorTab): void
}

/** Which tab the right-hand sidebar shows. Other features switch it (a workflow test → Run). */
export const useInspectorTab = create<InspectorTabState>()((set) => ({
  tab: "inspect",
  setTab: (tab) => set({ tab }),
}))
