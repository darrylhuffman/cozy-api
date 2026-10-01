import { create } from "zustand"
import { openWorkspaceFile } from "./open-file"

interface SubworkflowNavState {
  /** Sub-workflow path → the workflow it was opened from, for the back pill. */
  from: Record<string, string>
}

export const useSubworkflowNav = create<SubworkflowNavState>(() => ({ from: {} }))

/**
 * Opens a sub-workflow in its own tab. `from` is the workflow it was opened
 * from; its tab shows a pill back to it.
 */
export function openSubworkflow(path: string, from?: string): void {
  if (from && from !== path) {
    useSubworkflowNav.setState((s) => ({ from: { ...s.from, [path]: from } }))
  }
  openWorkspaceFile(path)
}
