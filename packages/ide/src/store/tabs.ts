import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { FileKind } from "@/data/mock-files";

export interface OpenTab {
  id: string; // file id from the tree
  title: string; // display label
  kind: FileKind;
  path?: string; // relative path from workspace root (e.g., "workflows/users/create.workflow")
}

interface TabsState {
  tabs: OpenTab[];
  activeId: string | null;

  openTab(tab: OpenTab): void;
  closeTab(id: string): void;
  selectTab(id: string): void;
}

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeId: null,

      openTab(tab) {
        const exists = get().tabs.find((t) => t.id === tab.id);
        if (exists) {
          set({ activeId: tab.id });
          return;
        }
        set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
      },

      closeTab(id) {
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id);
          let activeId = s.activeId;
          if (s.activeId === id) {
            // Activate the next-rightmost remaining tab (or null if no tabs left)
            activeId =
              tabs.length > 0 ? (tabs[tabs.length - 1]?.id ?? null) : null;
          }
          return { tabs, activeId };
        });
      },

      selectTab(id) {
        if (get().tabs.find((t) => t.id === id)) set({ activeId: id });
      },
    }),
    {
      name: "lorien-ide-tabs",
      version: 1,
    },
  ),
);
