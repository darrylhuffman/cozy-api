import type { Monaco } from "@monaco-editor/react"
import { THEMES, type ThemeDef } from "@/lib/themes"

/**
 * Monaco themes built from the app themes in themes.ts: the editor sits on
 * the page background instead of Monaco's own grey, with the theme's accent
 * for the cursor and selection. Themes based on VS Code themes also bring
 * their syntax colours.
 */

export function monacoThemeName(theme: ThemeDef): string {
  return `lorien-${theme.id}`
}

function hex(color: string): string {
  return color.replace(/^#/, "")
}

function syntaxRules(t: ThemeDef) {
  const s = t.syntax
  if (!s) return []
  return [
    { token: "comment", foreground: hex(s.comment), fontStyle: "italic" },
    { token: "keyword", foreground: hex(s.keyword) },
    { token: "string", foreground: hex(s.string) },
    { token: "string.key.json", foreground: hex(s.key) },
    { token: "string.escape", foreground: hex(s.operator) },
    { token: "number", foreground: hex(s.number) },
    { token: "type", foreground: hex(s.type) },
    { token: "type.identifier", foreground: hex(s.type) },
    { token: "regexp", foreground: hex(s.regexp) },
    { token: "operator", foreground: hex(s.operator) },
    { token: "delimiter", foreground: hex(t.palette.foreground) },
    { token: "identifier", foreground: hex(t.palette.foreground) },
    { token: "tag", foreground: hex(s.keyword) },
    { token: "attribute.name", foreground: hex(s.type) },
    { token: "attribute.value", foreground: hex(s.string) },
  ]
}

let defined = false

/** Registers a Monaco theme for every app theme, once per page. */
export function defineMonacoThemes(monaco: Monaco): void {
  if (defined) return
  defined = true
  for (const t of THEMES as readonly ThemeDef[]) {
    const c = t.palette
    const selection = `${c.primary}${t.mode === "dark" ? "33" : "26"}`
    monaco.editor.defineTheme(monacoThemeName(t), {
      base: t.mode === "dark" ? "vs-dark" : "vs",
      inherit: true,
      rules: syntaxRules(t),
      colors: {
        "editor.background": c.background,
        "editor.foreground": c.foreground,
        "editorGutter.background": c.background,
        "editorLineNumber.foreground": `${c.mutedForeground}99`,
        "editorLineNumber.activeForeground": c.foreground,
        "editor.lineHighlightBackground": c.card,
        "editor.lineHighlightBorder": c.card,
        "editorCursor.foreground": c.primary,
        "editor.selectionBackground": selection,
        "editor.inactiveSelectionBackground": selection,
        "editorIndentGuide.background1": c.border,
        "editorIndentGuide.activeBackground1": c.input,
        "editorWidget.background": c.popover,
        "editorWidget.border": c.border,
        "editorHoverWidget.background": c.popover,
        "editorHoverWidget.border": c.border,
        "editorSuggestWidget.background": c.popover,
        "editorSuggestWidget.border": c.border,
        "editorSuggestWidget.selectedBackground": c.accent,
        focusBorder: `${c.primary}80`,
        "scrollbarSlider.background": `${c.input}80`,
        "scrollbarSlider.hoverBackground": c.input,
        "scrollbarSlider.activeBackground": c.input,
      },
    })
  }
}
