import { create } from "zustand"
import { persist } from "zustand/middleware"

export type Theme = "light" | "dark"

interface ThemeState {
  theme: Theme
  setTheme(t: Theme): void
  toggle(): void
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme:
        typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",
      setTheme(t) {
        set({ theme: t })
        applyTheme(t)
      },
      toggle() {
        const next = get().theme === "dark" ? "light" : "dark"
        set({ theme: next })
        applyTheme(next)
      },
    }),
    {
      name: "lorien-ide-theme",
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme)
      },
    },
  ),
)

export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return
  document.documentElement.classList.toggle("dark", t === "dark")
}
