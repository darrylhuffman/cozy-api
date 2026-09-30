import { create } from "zustand"
import { persist } from "zustand/middleware"

/** IDE preferences other than the theme (which lives in store/theme.ts). */
export type CanvasBackground = "dots" | "lines" | "none"

export interface Settings {
  editorFontSize: number
  editorWordWrap: boolean
  editorMinimap: boolean
  editorLineNumbers: boolean
  canvasBackground: CanvasBackground
  canvasMinimap: boolean
  canvasSnapToGrid: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  editorFontSize: 13,
  editorWordWrap: true,
  editorMinimap: false,
  editorLineNumbers: true,
  canvasBackground: "dots",
  canvasMinimap: true,
  canvasSnapToGrid: false,
}

export const EDITOR_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20] as const

/** Canvas grid spacing; snapping uses the same step so nodes land on the dots. */
export const CANVAS_GRID = 20

interface SettingsState extends Settings {
  update(patch: Partial<Settings>): void
  reset(): void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update(patch) {
        set(patch)
      },
      reset() {
        set(DEFAULT_SETTINGS)
      },
    }),
    {
      name: "lorien-ide-settings",
      partialize: ({ update: _u, reset: _r, ...rest }) => rest,
    },
  ),
)

/** Whether the Settings dialog is open; anything can open it (menu, title bar, Ctrl+,). */
export const useSettingsDialog = create<{
  open: boolean
  setOpen(open: boolean): void
}>()((set) => ({
  open: false,
  setOpen(open) {
    set({ open })
  },
}))

export function openSettings(): void {
  useSettingsDialog.getState().setOpen(true)
}
