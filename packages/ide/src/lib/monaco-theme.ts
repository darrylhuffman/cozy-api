import type { Monaco } from "@monaco-editor/react"

/**
 * Monaco themes that match the app's tokens in globals.css: the editor sits
 * on the page background instead of Monaco's own grey, with the gold accent
 * for the cursor and selection. Monaco needs literal colours, so the values
 * mirror the CSS variables.
 */
const PALETTE = {
  dark: {
    base: "vs-dark",
    background: "#0e1116",
    foreground: "#e8ecf2",
    muted: "#8a94a3",
    lineHighlight: "#14181f",
    border: "#232a34",
    input: "#313946",
    popover: "#1a1f27",
    accent: "#e3b95e",
    selection: "#e3b95e33",
  },
  light: {
    base: "vs",
    background: "#f3f5f8",
    foreground: "#161a21",
    muted: "#5e6878",
    lineHighlight: "#ffffff",
    border: "#dfe3ea",
    input: "#cdd3dd",
    popover: "#ffffff",
    accent: "#8a5f0a",
    selection: "#8a5f0a26",
  },
} as const

export type AppTheme = keyof typeof PALETTE

export function monacoThemeName(theme: AppTheme): string {
  return `lorien-${theme}`
}

let defined = false

/** Registers the lorien-dark / lorien-light themes once per page. */
export function defineMonacoThemes(monaco: Monaco): void {
  if (defined) return
  defined = true
  for (const [name, c] of Object.entries(PALETTE)) {
    monaco.editor.defineTheme(monacoThemeName(name as AppTheme), {
      base: c.base,
      inherit: true,
      rules: [],
      colors: {
        "editor.background": c.background,
        "editor.foreground": c.foreground,
        "editorGutter.background": c.background,
        "editorLineNumber.foreground": `${c.muted}99`,
        "editorLineNumber.activeForeground": c.foreground,
        "editor.lineHighlightBackground": c.lineHighlight,
        "editor.lineHighlightBorder": c.lineHighlight,
        "editorCursor.foreground": c.accent,
        "editor.selectionBackground": c.selection,
        "editor.inactiveSelectionBackground": `${c.selection}`,
        "editorIndentGuide.background1": c.border,
        "editorIndentGuide.activeBackground1": c.input,
        "editorWidget.background": c.popover,
        "editorWidget.border": c.border,
        "editorHoverWidget.background": c.popover,
        "editorHoverWidget.border": c.border,
        "editorSuggestWidget.background": c.popover,
        "editorSuggestWidget.border": c.border,
        focusBorder: `${c.accent}80`,
        "scrollbarSlider.background": `${c.input}80`,
        "scrollbarSlider.hoverBackground": c.input,
        "scrollbarSlider.activeBackground": c.input,
      },
    })
  }
}
