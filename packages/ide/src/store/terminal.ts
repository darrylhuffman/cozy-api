import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { type ITheme, Terminal } from "@xterm/xterm"
import { create } from "zustand"
import {
  fetchTerminalInfo,
  type TerminalClientMsg,
  type TerminalInfo,
  type TerminalServerMsg,
  type TerminalShell,
  terminalSocketUrl,
} from "@/lib/terminal"

/**
 * The terminal tabs. Each tab is an xterm.js terminal wired to one shell on
 * the IDE server over a WebSocket. The xterm instances live outside React so
 * a tab keeps its shell and scrollback while the pane is hidden or moved.
 */

export interface TerminalTab {
  id: string
  shell: TerminalShell
  /** Set once the shell has exited. */
  exitCode: number | null
}

interface TerminalState {
  info: TerminalInfo | null
  error: string | null
  tabs: TerminalTab[]
  activeId: string | null
  load(): Promise<TerminalInfo | null>
  /** Opens a new tab running `shellId`, or the default shell. */
  add(shellId?: string): Promise<void>
  close(id: string): void
  setActive(id: string): void
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

let theme: ITheme = {}
let fontFamily = "ui-monospace, monospace"
let nextId = 1

class TerminalSession {
  readonly term: Terminal
  readonly fit = new FitAddon()
  /** The element xterm draws into; moved between containers as the pane remounts. */
  readonly host = document.createElement("div")
  private ws: WebSocket | null = null
  private opened = false

  constructor(
    readonly tab: TerminalTab,
    private readonly token: string,
    private readonly onExit: (code: number) => void,
  ) {
    this.host.className = "h-full w-full"
    this.term = new Terminal({
      theme,
      fontFamily,
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
    })
    this.term.loadAddon(this.fit)
    this.term.loadAddon(new WebLinksAddon())
    // Copy and paste like a desktop terminal: Ctrl+C copies when text is
    // selected (else it interrupts), Ctrl+V pastes. On a Mac, Cmd does both.
    this.term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || isMac) return true
      const key = e.key.toLowerCase()
      if (e.ctrlKey && key === "c" && (e.shiftKey || this.term.hasSelection())) {
        void navigator.clipboard?.writeText(this.term.getSelection())
        this.term.clearSelection()
        return false
      }
      // Leave Ctrl+V to the browser so its paste event reaches xterm.
      if (e.ctrlKey && key === "v") return false
      return true
    })
    this.term.onData((d) => this.send({ t: "in", d }))
    this.term.onResize(({ cols, rows }) => this.send({ t: "resize", cols, rows }))
  }

  /** Shows the terminal in `container`; the first time, also starts its shell. */
  attach(container: HTMLElement) {
    if (this.host.parentElement !== container) container.appendChild(this.host)
    if (!this.opened) {
      this.opened = true
      this.term.open(this.host)
      this.layout()
      this.connect()
    } else {
      this.layout()
    }
  }

  /** Fits the terminal to its container, when the container has a size. */
  layout() {
    if (!this.opened || this.host.clientWidth === 0 || this.host.clientHeight === 0) return
    try {
      this.fit.fit()
    } catch {
      // xterm can throw while its renderer is still measuring; the next resize fits it.
    }
  }

  focus() {
    this.term.focus()
  }

  private connect() {
    const ws = new WebSocket(
      terminalSocketUrl(this.token, this.tab.shell.id, {
        cols: this.term.cols,
        rows: this.term.rows,
      }),
    )
    this.ws = ws
    let exited = false
    ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as TerminalServerMsg
      if (msg.t === "out") this.term.write(msg.d)
      else if (msg.t === "exit") {
        exited = true
        this.term.write(`\r\n\x1b[2m[Process exited with code ${msg.code}]\x1b[0m\r\n`)
        this.onExit(msg.code)
      }
    }
    ws.onclose = () => {
      if (exited || this.ws !== ws) return
      this.term.write("\r\n\x1b[2m[The terminal lost its connection to the IDE server]\x1b[0m\r\n")
      this.onExit(-1)
    }
  }

  private send(msg: TerminalClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  dispose() {
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.term.dispose()
    this.host.remove()
  }
}

const sessions = new Map<string, TerminalSession>()

export function terminalSession(id: string): TerminalSession | undefined {
  return sessions.get(id)
}

/** Re-colours every terminal, and the ones opened later, for an IDE theme. */
export function setTerminalAppearance(next: ITheme, font: string) {
  theme = next
  fontFamily = font
  for (const s of sessions.values()) {
    s.term.options.theme = next
    if (s.term.options.fontFamily !== font) {
      s.term.options.fontFamily = font
      s.layout()
    }
  }
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  info: null,
  error: null,
  tabs: [],
  activeId: null,

  async load() {
    try {
      const info = await fetchTerminalInfo()
      set({ info, error: null })
      return info
    } catch (e) {
      set({ error: (e as Error).message })
      return null
    }
  },

  async add(shellId) {
    const info = get().info ?? (await get().load())
    if (!info?.available) return
    const shell = info.shells.find((s) => s.id === shellId) ?? info.shells[0]
    if (!shell) return
    const tab: TerminalTab = { id: `term-${nextId++}`, shell, exitCode: null }
    sessions.set(
      tab.id,
      new TerminalSession(tab, info.token, (code) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, exitCode: code } : t)),
        })),
      ),
    )
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
  },

  close(id) {
    sessions.get(id)?.dispose()
    sessions.delete(id)
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeId =
        s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.activeId
      return { tabs, activeId }
    })
  },

  setActive(id) {
    set({ activeId: id })
  },
}))
