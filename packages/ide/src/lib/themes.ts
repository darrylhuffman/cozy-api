/**
 * The IDE's colour themes. Each theme is a palette of the app's tokens
 * (the CSS variables in globals.css) plus syntax colours for Monaco, so one
 * entry themes the chrome, the React Flow canvas and the code editors.
 *
 * "dark" and "light" are lorien's own themes and mirror globals.css. Moria,
 * Shire, Mordor and Erebor are lorien's other Middle-earth themes; the rest
 * are based on popular VS Code themes.
 */

export type ThemeMode = "light" | "dark"

export interface ThemePalette {
  /** Page and canvas background; also the code editor background. */
  background: string
  /** Side panels, title bar, status bar. */
  card: string
  /** Menus, popovers, dialogs. */
  popover: string
  /** Quiet fills (inputs, chips). */
  muted: string
  /** Hover / selected fills. */
  accent: string
  foreground: string
  mutedForeground: string
  border: string
  input: string
  primary: string
  primaryForeground: string
  destructive: string
  success: string
  warning: string
  info: string
  ai: string
  /** Sub-workflows. Optional: themes without one get a rose that suits their mode. */
  flow?: string
  canvasDot: string
}

export interface ThemeSyntax {
  comment: string
  keyword: string
  string: string
  number: string
  type: string
  /** Object keys in JSON bodies. */
  key: string
  regexp: string
  operator: string
}

export interface ThemeDef {
  id: string
  label: string
  /** Where the palette comes from, shown under the name in Settings. */
  basedOn?: string
  mode: ThemeMode
  palette: ThemePalette
  /** Omitted for lorien's own themes, which keep Monaco's default token colours. */
  syntax?: ThemeSyntax
}

export const THEMES = [
  {
    id: "dark",
    label: "Lorien Dark",
    mode: "dark",
    // Near-neutral darks with a faint forest lean; leaf-green highlights.
    palette: {
      background: "#0d110f",
      card: "#121714",
      popover: "#171d19",
      muted: "#171d19",
      accent: "#1f2722",
      foreground: "#e6ede8",
      mutedForeground: "#8b978f",
      border: "#212a24",
      input: "#2f3a33",
      primary: "#7bd389",
      primaryForeground: "#08170c",
      destructive: "#f4776a",
      success: "#4cc9a8",
      warning: "#f2b45a",
      info: "#74adff",
      ai: "#bba2ff",
      canvasDot: "#222b25",
    },
  },
  {
    id: "light",
    label: "Lorien Light",
    mode: "light",
    palette: {
      background: "#f3f6f3",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#eaf0eb",
      accent: "#e0e8e2",
      foreground: "#141a16",
      mutedForeground: "#59665d",
      border: "#dae2dc",
      input: "#c7d2ca",
      primary: "#2e7d3c",
      primaryForeground: "#ffffff",
      destructive: "#c0392b",
      success: "#0f7a64",
      warning: "#a8560c",
      info: "#1e5fc9",
      ai: "#6b46d6",
      canvasDot: "#d2dcd5",
    },
  },
  {
    id: "moria",
    label: "Moria",
    mode: "dark",
    // Deep mine blacks with a cold blue cast; mithril-blue highlights.
    palette: {
      background: "#0b0d12",
      card: "#10131a",
      popover: "#151923",
      muted: "#151923",
      accent: "#1c2230",
      foreground: "#e3e8f2",
      mutedForeground: "#8a93a6",
      border: "#1f2533",
      input: "#2c3445",
      primary: "#6ea8ff",
      primaryForeground: "#06101f",
      destructive: "#f2766b",
      success: "#4cc9a8",
      warning: "#f0b35a",
      info: "#8fd3ff",
      ai: "#b9a2ff",
      canvasDot: "#1f2533",
    },
  },
  {
    id: "shire-dark",
    label: "Shire Dark",
    mode: "dark",
    // Warm earthy browns at night; grass-green highlights.
    palette: {
      background: "#12110c",
      card: "#17160f",
      popover: "#1d1b13",
      muted: "#1d1b13",
      accent: "#26241a",
      foreground: "#ece6d6",
      mutedForeground: "#9c9580",
      border: "#29261b",
      input: "#3a3627",
      primary: "#9fc86a",
      primaryForeground: "#121a06",
      destructive: "#e8735f",
      success: "#5fbf8f",
      warning: "#e9b35c",
      info: "#7fb0e0",
      ai: "#c1a2f0",
      canvasDot: "#2a271c",
    },
  },
  {
    id: "shire-light",
    label: "Shire Light",
    mode: "light",
    // Parchment and soil in daylight; deep grass-green highlights.
    palette: {
      background: "#f6f1e4",
      card: "#fbf8ef",
      popover: "#fffdf6",
      muted: "#efe8d6",
      accent: "#e6dec8",
      foreground: "#2b2518",
      mutedForeground: "#6f6650",
      border: "#e0d7c0",
      input: "#cfc4a8",
      primary: "#4f7a28",
      primaryForeground: "#ffffff",
      destructive: "#b53a27",
      success: "#2f7d5a",
      warning: "#9a5a10",
      info: "#2a64b0",
      ai: "#6b46c6",
      canvasDot: "#ddd3b8",
    },
  },
  {
    id: "mordor",
    label: "Mordor",
    mode: "dark",
    // Ash-black with a red cast; ember-red highlights, crimson for errors.
    palette: {
      background: "#0f0b0b",
      card: "#151010",
      popover: "#1b1414",
      muted: "#1b1414",
      accent: "#261b1a",
      foreground: "#efe4e1",
      mutedForeground: "#a08e8a",
      border: "#2a1e1d",
      input: "#3b2b29",
      primary: "#ff6a3d",
      primaryForeground: "#1a0603",
      destructive: "#ff4f6e",
      success: "#5cc39b",
      warning: "#f0b44c",
      info: "#7aa8f0",
      ai: "#c3a0ff",
      canvasDot: "#2a1e1d",
    },
  },
  {
    id: "erebor",
    label: "Erebor",
    mode: "dark",
    // Cool stone greys; dwarf-gold highlights.
    palette: {
      background: "#111214",
      card: "#16171a",
      popover: "#1c1d21",
      muted: "#1c1d21",
      accent: "#25272c",
      foreground: "#e7e7e9",
      mutedForeground: "#94969c",
      border: "#26282d",
      input: "#36383e",
      primary: "#d9b25f",
      primaryForeground: "#1a1406",
      destructive: "#ef6b62",
      success: "#5cc39b",
      warning: "#e8995a",
      info: "#7fa9e6",
      ai: "#b7a1f5",
      canvasDot: "#26282d",
    },
  },
  {
    id: "one-dark-pro",
    label: "One Dark Pro",
    basedOn: "Atom's One Dark",
    mode: "dark",
    palette: {
      background: "#282c34",
      card: "#21252b",
      popover: "#2c313a",
      muted: "#2c313a",
      accent: "#353b45",
      foreground: "#d7dae0",
      mutedForeground: "#8b929e",
      border: "#181a1f",
      input: "#3e4452",
      primary: "#61afef",
      primaryForeground: "#1b1f27",
      destructive: "#e06c75",
      success: "#98c379",
      warning: "#d19a66",
      info: "#56b6c2",
      ai: "#c678dd",
      canvasDot: "#363b45",
    },
    syntax: {
      comment: "#7f848e",
      keyword: "#c678dd",
      string: "#98c379",
      number: "#d19a66",
      type: "#e5c07b",
      key: "#e06c75",
      regexp: "#56b6c2",
      operator: "#56b6c2",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    mode: "dark",
    palette: {
      background: "#282a36",
      card: "#21222c",
      popover: "#343746",
      muted: "#2f3140",
      accent: "#44475a",
      foreground: "#f8f8f2",
      mutedForeground: "#9aa1c4",
      border: "#191a21",
      input: "#44475a",
      primary: "#bd93f9",
      primaryForeground: "#21222c",
      destructive: "#ff5555",
      success: "#50fa7b",
      warning: "#ffb86c",
      info: "#8be9fd",
      ai: "#ff79c6",
      canvasDot: "#3b3d4f",
    },
    syntax: {
      comment: "#6272a4",
      keyword: "#ff79c6",
      string: "#f1fa8c",
      number: "#bd93f9",
      type: "#8be9fd",
      key: "#8be9fd",
      regexp: "#ff5555",
      operator: "#ff79c6",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    mode: "dark",
    palette: {
      background: "#1a1b26",
      card: "#16161e",
      popover: "#1f2335",
      muted: "#1f2335",
      accent: "#292e42",
      foreground: "#c0caf5",
      mutedForeground: "#7f86ad",
      border: "#101014",
      input: "#3b4261",
      primary: "#7aa2f7",
      primaryForeground: "#16161e",
      destructive: "#f7768e",
      success: "#9ece6a",
      warning: "#ff9e64",
      info: "#7dcfff",
      ai: "#bb9af7",
      canvasDot: "#292e42",
    },
    syntax: {
      comment: "#565f89",
      keyword: "#bb9af7",
      string: "#9ece6a",
      number: "#ff9e64",
      type: "#2ac3de",
      key: "#7aa2f7",
      regexp: "#b4f9f8",
      operator: "#89ddff",
    },
  },
  {
    id: "nord",
    label: "Nord",
    mode: "dark",
    palette: {
      background: "#2e3440",
      card: "#292e39",
      popover: "#3b4252",
      muted: "#3b4252",
      accent: "#434c5e",
      foreground: "#eceff4",
      mutedForeground: "#9aa3b5",
      border: "#232831",
      input: "#4c566a",
      primary: "#88c0d0",
      primaryForeground: "#2e3440",
      destructive: "#bf616a",
      success: "#a3be8c",
      warning: "#d08770",
      info: "#81a1c1",
      ai: "#b48ead",
      canvasDot: "#3b4252",
    },
    syntax: {
      comment: "#616e88",
      keyword: "#81a1c1",
      string: "#a3be8c",
      number: "#b48ead",
      type: "#8fbcbb",
      key: "#8fbcbb",
      regexp: "#ebcb8b",
      operator: "#81a1c1",
    },
  },
  {
    id: "github-light",
    label: "GitHub Light",
    mode: "light",
    palette: {
      background: "#f6f8fa",
      card: "#ffffff",
      popover: "#ffffff",
      muted: "#f6f8fa",
      accent: "#eaeef2",
      foreground: "#1f2328",
      mutedForeground: "#59636e",
      border: "#d8dee4",
      input: "#d0d7de",
      primary: "#0969da",
      primaryForeground: "#ffffff",
      destructive: "#cf222e",
      success: "#1a7f37",
      warning: "#9a6700",
      info: "#0969da",
      ai: "#8250df",
      canvasDot: "#d0d7de",
    },
    syntax: {
      comment: "#6e7781",
      keyword: "#cf222e",
      string: "#0a3069",
      number: "#0550ae",
      type: "#953800",
      key: "#0550ae",
      regexp: "#116329",
      operator: "#cf222e",
    },
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    mode: "light",
    palette: {
      background: "#fdf6e3",
      card: "#f5efdc",
      popover: "#fffbf0",
      muted: "#eee8d5",
      accent: "#e8e1ca",
      foreground: "#3f555c",
      mutedForeground: "#6c7f84",
      border: "#e3dcc6",
      input: "#d3cbb3",
      primary: "#268bd2",
      primaryForeground: "#fdf6e3",
      destructive: "#dc322f",
      success: "#859900",
      warning: "#cb4b16",
      info: "#2aa198",
      ai: "#6c71c4",
      canvasDot: "#e6dec6",
    },
    syntax: {
      comment: "#93a1a1",
      keyword: "#859900",
      string: "#2aa198",
      number: "#d33682",
      type: "#b58900",
      key: "#268bd2",
      regexp: "#dc322f",
      operator: "#859900",
    },
  },
] as const satisfies readonly ThemeDef[]

export type ThemeId = (typeof THEMES)[number]["id"]

export const DEFAULT_DARK: ThemeId = "dark"
export const DEFAULT_LIGHT: ThemeId = "light"

const BY_ID = new Map<string, ThemeDef>(THEMES.map((t) => [t.id, t]))

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && BY_ID.has(value)
}

export function getTheme(id: ThemeId): ThemeDef {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_DARK) as ThemeDef)
}

/** The CSS variables a theme sets on <html>; names match globals.css. */
export function themeCssVars(t: ThemeDef): Record<string, string> {
  const p = t.palette
  return {
    "--background": p.background,
    "--foreground": p.foreground,
    "--card": p.card,
    "--card-foreground": p.foreground,
    "--popover": p.popover,
    "--popover-foreground": p.foreground,
    "--primary": p.primary,
    "--primary-foreground": p.primaryForeground,
    "--secondary": p.accent,
    "--secondary-foreground": p.foreground,
    "--muted": p.muted,
    "--muted-foreground": p.mutedForeground,
    "--accent": p.accent,
    "--accent-foreground": p.foreground,
    "--destructive": p.destructive,
    "--border": p.border,
    "--input": p.input,
    "--ring": p.primary,
    "--success": p.success,
    "--warning": p.warning,
    "--info": p.info,
    "--ai": p.ai,
    "--flow": p.flow ?? (t.mode === "dark" ? "#f29cc8" : "#b23c7a"),
    "--canvas-dot": p.canvasDot,
    "--sidebar": p.card,
    "--sidebar-foreground": p.foreground,
    "--sidebar-primary": p.primary,
    "--sidebar-primary-foreground": p.primaryForeground,
    "--sidebar-accent": p.accent,
    "--sidebar-accent-foreground": p.foreground,
    "--sidebar-border": p.border,
    "--sidebar-ring": p.primary,
  }
}
