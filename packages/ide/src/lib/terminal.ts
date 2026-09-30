import type { ITheme } from "@xterm/xterm"
import type { ThemeDef } from "@/lib/themes"

/**
 * The integrated terminal's link to the IDE server: which shells it offers,
 * the socket that runs one, and xterm colours from the IDE theme.
 */

export interface TerminalShell {
  id: string
  label: string
}

export interface TerminalInfo {
  available: boolean
  /** Why the terminal can't run here, when it can't. */
  reason?: string
  /** The default shell first. */
  shells: TerminalShell[]
  token: string
}

export async function fetchTerminalInfo(): Promise<TerminalInfo> {
  const res = await fetch("/api/terminal/info")
  const body = (await res.json().catch(() => ({}))) as Partial<TerminalInfo> & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `Loading the terminal failed (HTTP ${res.status})`)
  return body as TerminalInfo
}

export function terminalSocketUrl(
  token: string,
  shell: string,
  size: { cols: number; rows: number },
): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:"
  const q = new URLSearchParams({
    token,
    shell,
    cols: String(size.cols),
    rows: String(size.rows),
  })
  return `${scheme}//${location.host}/api/terminal/socket?${q}`
}

/** Messages to the server; mirrors packages/build/src/commands/terminal.ts. */
export type TerminalClientMsg = { t: "in"; d: string } | { t: "resize"; cols: number; rows: number }

export type TerminalServerMsg = { t: "out"; d: string } | { t: "exit"; code: number }

const DARK_ANSI = {
  black: "#3b4252",
  brightBlack: "#6b7280",
  white: "#d8dee9",
  brightWhite: "#ffffff",
  cyan: "#56b6c2",
  brightCyan: "#7fd4df",
}

const LIGHT_ANSI = {
  black: "#1f2328",
  brightBlack: "#6e7781",
  white: "#8c959f",
  brightWhite: "#b1bac4",
  cyan: "#0f7b8a",
  brightCyan: "#1b9aaa",
}

/**
 * xterm colours for an IDE theme: the page background and text, the theme's
 * accent for the cursor and selection, and its status colours for the ANSI
 * reds, greens, yellows, blues and magentas, so `ls` and git look at home.
 */
export function xtermTheme(t: ThemeDef): ITheme {
  const c = t.palette
  const s = t.syntax
  const base = t.mode === "dark" ? DARK_ANSI : LIGHT_ANSI
  return {
    background: c.background,
    foreground: c.foreground,
    cursor: c.primary,
    cursorAccent: c.background,
    selectionBackground: `${c.primary}${t.mode === "dark" ? "40" : "33"}`,
    scrollbarSliderBackground: `${c.input}80`,
    scrollbarSliderHoverBackground: c.input,
    scrollbarSliderActiveBackground: c.input,
    ...base,
    red: c.destructive,
    brightRed: c.destructive,
    green: c.success,
    brightGreen: c.success,
    yellow: c.warning,
    brightYellow: s?.number ?? c.warning,
    blue: c.info,
    brightBlue: s?.type ?? c.info,
    magenta: c.ai,
    brightMagenta: s?.keyword ?? c.ai,
  }
}
