import { useEffect } from "react"
import { useTabsStore } from "@/store/tabs"

/**
 * Asks the browser to confirm before the page unloads (reload, close, navigate
 * away) while any workflow or code tab has unsaved changes.
 */
export function useUnsavedChangesGuard(): void {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!useTabsStore.getState().tabs.some((t) => t.dirty)) return
      e.preventDefault()
      // Legacy browsers require returnValue to be set to show the prompt.
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [])
}
