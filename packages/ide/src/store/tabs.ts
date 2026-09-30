import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useShallow } from "zustand/react/shallow"

export interface OpenTab {
  id: string // file id from the tree
  title: string // display label
  /** "node" is every code tab (nodes, providers, lib). */
  kind: "workflow" | "node"
  path?: string // relative path from workspace root (e.g., "workflows/users/create.workflow")
  dirty?: boolean // true when the tab has unsaved changes
}

interface TabsState {
  tabs: OpenTab[]
  /** The tab shown in the editor area (workflows and code share one strip). */
  activeId: string | null
  /** Last active workflow tab — drives the Inspector, Tests and Run panels. */
  activeWorkflowId: string | null
  /** Last active code tab. */
  activeCodeId: string | null

  openTab(tab: OpenTab): void
  closeTab(id: string): void
  selectTab(id: string): void
  setDirty(id: string, dirty: boolean): void
  /** Moves a tab to `toIndex` (its index after the move). */
  moveTab(id: string, toIndex: number): void
}

/** Returns the state slice that tracks which tab is active for this tab's kind. */
function activationUpdate(tab: OpenTab): Partial<TabsState> {
  if (tab.kind === "workflow") return { activeId: tab.id, activeWorkflowId: tab.id }
  return { activeId: tab.id, activeCodeId: tab.id }
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,
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
          const index = s.tabs.findIndex((t) => t.id === id)
          const target = s.tabs[index]
          if (!target) return s

          const tabs = s.tabs.filter((t) => t.id !== id)
          const next: Partial<TabsState> = { tabs }

          // Per-kind pointers fall back to the last remaining tab of that kind.
          if (target.kind === "workflow" && s.activeWorkflowId === id) {
            const remaining = tabs.filter((t) => t.kind === "workflow")
            next.activeWorkflowId = remaining[remaining.length - 1]?.id ?? null
          }
          if (target.kind === "node" && s.activeCodeId === id) {
            const remaining = tabs.filter((t) => t.kind === "node")
            next.activeCodeId = remaining[remaining.length - 1]?.id ?? null
          }

          // The editor shows the neighbour that slid into the closed tab's
          // place (or the one before it when the last tab closed).
          if (s.activeId === id) {
            const neighbour = tabs[index] ?? tabs[index - 1] ?? null
            next.activeId = neighbour?.id ?? null
            if (neighbour) Object.assign(next, activationUpdate(neighbour))
          }
          return next
        })
      },

      selectTab(id) {
        const tab = get().tabs.find((t) => t.id === id)
        if (!tab) return
        set(activationUpdate(tab))
      },

      moveTab(id, toIndex) {
        set((s) => {
          const from = s.tabs.findIndex((t) => t.id === id)
          if (from < 0) return s
          const tabs = [...s.tabs]
          const [tab] = tabs.splice(from, 1)
          const to = Math.max(0, Math.min(toIndex, tabs.length))
          tabs.splice(to, 0, tab as OpenTab)
          return { tabs }
        })
      },

      setDirty(id, dirty) {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, dirty } : t)),
        }))
      },
    }),
    {
      name: "lorien-ide-tabs",
      version: 5,
      migrate(persistedState, fromVersion) {
        const state = persistedState as {
          tabs?: unknown
          activeId?: unknown
          activeWorkflowId?: unknown
          activeCodeId?: unknown
        }
        if (fromVersion < 2) {
          // Drop all tabs from before this schema; their shape was incomplete
          // (missing path, and activeId is now split into activeWorkflowId / activeCodeId).
          return { tabs: [], activeId: null, activeWorkflowId: null, activeCodeId: null }
        }
        // v2 → v3: dirty field added (optional, defaults to undefined = clean). No migration needed.
        // v3 → v4: node tab ids now use the file path instead of the tree node id.
        //   Drop persisted node tabs whose id doesn't look like a file path (i.e.
        //   ids that start with "n-" are legacy tree node ids). Workflow tabs are
        //   unaffected.
        let next = state
        if (fromVersion < 4) {
          const tabs = Array.isArray(state.tabs) ? state.tabs : []
          const cleaned = (tabs as Array<{ kind?: unknown; id?: unknown }>).filter(
            (t) => t.kind !== "node" || (typeof t.id === "string" && !t.id.startsWith("n-")),
          )
          next = { ...next, tabs: cleaned }
        }
        // v4 → v5: workflows and code share one editor; show the workflow
        // that was open, else the code file.
        if (fromVersion < 5) {
          next = { ...next, activeId: next.activeWorkflowId ?? next.activeCodeId ?? null }
        }
        return next as never
      },
    },
  ),
)

// Convenience selectors — useShallow prevents new-array-reference infinite loops
export const useWorkflowTabs = () =>
  useTabsStore(useShallow((s) => s.tabs.filter((t) => t.kind === "workflow")))
export const useCodeTabs = () =>
  useTabsStore(useShallow((s) => s.tabs.filter((t) => t.kind === "node")))
