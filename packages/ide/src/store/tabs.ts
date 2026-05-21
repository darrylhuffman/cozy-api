import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"
import type { FileKind } from "@/data/mock-files"

export interface OpenTab {
  id: string // file id from the tree
  title: string // display label
  kind: FileKind
  path?: string // relative path from workspace root (e.g., "workflows/users/create.workflow")
  dirty?: boolean // true when the tab has unsaved changes
}

interface TabsState {
  tabs: OpenTab[]
  activeWorkflowId: string | null
  activeCodeId: string | null

  openTab(tab: OpenTab): void
  closeTab(id: string): void
  selectTab(id: string): void
  setDirty(id: string, dirty: boolean): void
}

/** Returns the state slice that tracks which tab is active for this tab's kind. */
function activationUpdate(tab: OpenTab): Partial<TabsState> {
  if (tab.kind === "workflow") return { activeWorkflowId: tab.id }
  return { activeCodeId: tab.id }
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeWorkflowId: null,
      activeCodeId: null,

      openTab(tab) {
        const existing = get().tabs.find((t) => t.id === tab.id)
        if (existing) {
          // Refresh existing tab with the latest fields (title, path, etc.)
          // and activate it within its panel.
          set((s) => ({
            tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, ...tab } : t)),
            ...activationUpdate(tab),
          }))
          return
        }
        set((s) => ({
          tabs: [...s.tabs, tab],
          ...activationUpdate(tab),
        }))
      },

      closeTab(id) {
        set((s) => {
          const target = s.tabs.find((t) => t.id === id)
          if (!target) return s

          const tabs = s.tabs.filter((t) => t.id !== id)

          if (target.kind === "workflow") {
            const wasActive = s.activeWorkflowId === id
            if (!wasActive) return { tabs }
            const remaining = tabs.filter((t) => t.kind === "workflow")
            const activeWorkflowId =
              remaining.length > 0 ? (remaining[remaining.length - 1]?.id ?? null) : null
            return { tabs, activeWorkflowId }
          }

          // node kind
          const wasActive = s.activeCodeId === id
          if (!wasActive) return { tabs }
          const remaining = tabs.filter((t) => t.kind === "node")
          const activeCodeId =
            remaining.length > 0 ? (remaining[remaining.length - 1]?.id ?? null) : null
          return { tabs, activeCodeId }
        })
      },

      selectTab(id) {
        const tab = get().tabs.find((t) => t.id === id)
        if (!tab) return
        set(activationUpdate(tab))
      },

      setDirty(id, dirty) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
        }))
      },
    }),
    {
      name: "lorien-ide-tabs",
      version: 3,
      migrate(persistedState, fromVersion) {
        const state = persistedState as {
          tabs?: unknown
          activeWorkflowId?: unknown
          activeCodeId?: unknown
        }
        if (fromVersion < 2) {
          // Drop all tabs from before this schema; their shape was incomplete
          // (missing path, and activeId is now split into activeWorkflowId / activeCodeId).
          return { tabs: [], activeWorkflowId: null, activeCodeId: null }
        }
        // v2 → v3: dirty field added (optional, defaults to undefined = clean). No migration needed.
        return state as never
      },
    },
  ),
)

// Convenience selectors — useShallow prevents new-array-reference infinite loops
export const useWorkflowTabs = () =>
  useTabsStore(useShallow((s) => s.tabs.filter((t) => t.kind === "workflow")))
export const useCodeTabs = () =>
  useTabsStore(useShallow((s) => s.tabs.filter((t) => t.kind === "node")))
