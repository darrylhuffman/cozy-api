import { create } from "zustand"
import { persist } from "zustand/middleware"
import {
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  getTheme,
  isThemeId,
  type ThemeDef,
  type ThemeId,
  themeCssVars,
} from "@/lib/themes"

/** A theme id, or "system" to follow the OS light/dark setting with lorien's own themes. */
export type ThemeChoice = ThemeId | "system"

interface ThemeState {
  /** What the user picked in Settings. Persisted. */
  theme: ThemeChoice
  /** Whether the OS currently prefers dark; only matters for "system". */
  systemDark: boolean
  setTheme(t: ThemeChoice): void
}

const STORAGE_KEY = "lorien-ide-theme"

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
  )
}

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ThemeDef {
  if (choice === "system") return getTheme(systemDark ? DEFAULT_DARK : DEFAULT_LIGHT)
  return getTheme(choice)
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "system",
      systemDark: prefersDark(),
      setTheme(t) {
        set({ theme: t })
        applyTheme(resolveTheme(t, get().systemDark))
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({ theme: s.theme }),
      merge: (persisted, current) => {
        const t = (persisted as { theme?: unknown } | undefined)?.theme
        return { ...current, theme: t === "system" || isThemeId(t) ? t : current.theme }
      },
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(resolveTheme(state.theme, state.systemDark))
      },
    },
  ),
)

if (typeof window !== "undefined" && window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (e) => {
    useThemeStore.setState({ systemDark: e.matches })
    const { theme } = useThemeStore.getState()
    if (theme === "system") applyTheme(resolveTheme(theme, e.matches))
  })
}

/** The theme currently on screen. */
export function useActiveTheme(): ThemeDef {
  return useThemeStore((s) => resolveTheme(s.theme, s.systemDark))
}

/** Puts a theme's tokens on <html> and sets the .dark class for its mode. */
export function applyTheme(t: ThemeDef): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.classList.toggle("dark", t.mode === "dark")
  root.dataset.theme = t.id
  for (const [name, value] of Object.entries(themeCssVars(t))) {
    root.style.setProperty(name, value)
  }
}

/** Applies the persisted theme before React mounts, so the first paint is already themed. */
export function applyStoredTheme(): void {
  let choice: ThemeChoice = "system"
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
    const t = stored?.state?.theme
    if (t === "system" || isThemeId(t)) choice = t
  } catch {
    // ignore; fall back to the OS setting
  }
  applyTheme(resolveTheme(choice, prefersDark()))
}
