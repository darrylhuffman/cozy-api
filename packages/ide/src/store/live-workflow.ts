import { create } from "zustand"
import type { WorkflowFile } from "@/lib/api"

interface LiveWorkflowState {
  /** Current in-memory workflow being edited. null when no workflow tab is active. */
  workflow: WorkflowFile | null
  /** The tab id that owns the workflow. Used to detect stale subscribers when tabs switch. */
  tabId: string | null
  setLiveWorkflow: (tabId: string, wf: WorkflowFile | null) => void
  /** Clear if the current workflow belongs to the given tab. No-op otherwise. */
  clearIfTab: (tabId: string) => void
}

export const useLiveWorkflowStore = create<LiveWorkflowState>((set, get) => ({
  workflow: null,
  tabId: null,
  setLiveWorkflow: (tabId, wf) => set({ tabId, workflow: wf }),
  clearIfTab: (tabId) => {
    if (get().tabId === tabId) set({ workflow: null, tabId: null })
  },
}))
