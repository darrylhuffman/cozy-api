import "@xterm/xterm/css/xterm.css"
import { ChevronDown, Plus, SquareTerminal, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { xtermTheme } from "@/lib/terminal"
import { cn } from "@/lib/utils"
import { setTerminalAppearance, terminalSession, useTerminalStore } from "@/store/terminal"
import { useActiveTheme } from "@/store/theme"

/** The dockview panel API bits the terminal needs. */
interface PaneApi {
  isVisible: boolean
  onDidVisibilityChange(cb: (e: { isVisible: boolean }) => void): { dispose(): void }
}

let started = false

/**
 * A terminal on this machine: tabs of real shells (PowerShell or Command
 * Prompt on Windows, the login shell on macOS and Linux) started in the
 * project folder. The first tab opens the first time the pane is shown.
 */
export function TerminalPanel({ pane }: { pane?: PaneApi }) {
  const theme = useActiveTheme()
  const tabs = useTerminalStore((s) => s.tabs)
  const activeId = useTerminalStore((s) => s.activeId)
  const info = useTerminalStore((s) => s.info)
  const error = useTerminalStore((s) => s.error)
  const [visible, setVisible] = useState(pane?.isVisible ?? true)

  useEffect(() => {
    if (!pane) return
    const d = pane.onDidVisibilityChange((e) => setVisible(e.isVisible))
    return () => d.dispose()
  }, [pane])

  useEffect(() => {
    const font = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim()
    setTerminalAppearance(xtermTheme(theme), font || "ui-monospace, monospace")
  }, [theme])

  useEffect(() => {
    if (!visible) return
    const store = useTerminalStore.getState()
    if (!started) {
      started = true
      void store.add()
    } else if (!store.info && !store.error) void store.load()
  }, [visible])

  const unavailable = error ?? (info && !info.available ? (info.reason ?? "") : null)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="terminal-panel">
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 gap-0.5">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group flex h-6 min-w-0 items-center rounded-md text-[12px]",
                t.id === activeId
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={t.id === activeId}
                onClick={() => useTerminalStore.getState().setActive(t.id)}
                className="flex min-w-0 items-center gap-1.5 pr-1 pl-2"
              >
                <SquareTerminal aria-hidden className="size-3.5 shrink-0" />
                <span className={cn("truncate", t.exitCode !== null && "line-through opacity-70")}>
                  {t.shell.label}
                </span>
              </button>
              <button
                type="button"
                aria-label={`Close ${t.shell.label}`}
                title="Close (ends the shell)"
                onClick={() => useTerminalStore.getState().close(t.id)}
                className={cn(
                  "mr-1 rounded p-0.5 hover:bg-background",
                  t.id === activeId ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <NewTerminal />
      </div>
      <div className="relative min-h-0 flex-1">
        {unavailable !== null ? (
          <Unavailable reason={unavailable} />
        ) : tabs.length === 0 ? (
          info && (
            <div className="flex h-full items-center justify-center">
              <button
                type="button"
                onClick={() => void useTerminalStore.getState().add()}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12.5px] hover:bg-accent"
              >
                <Plus className="size-3.5" /> New terminal
              </button>
            </div>
          )
        ) : (
          tabs.map((t) => (
            <TerminalView key={t.id} id={t.id} active={t.id === activeId} visible={visible} />
          ))
        )}
      </div>
    </div>
  )
}

/** One tab's terminal; stays mounted while hidden so it keeps its size in step. */
function TerminalView({ id, active, visible }: { id: string; active: boolean; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    const session = terminalSession(id)
    if (!el || !session || !active || !visible) return
    session.attach(el)
    session.focus()
    const ro = new ResizeObserver(() => session.layout())
    ro.observe(el)
    // Webfonts change the cell size once they load.
    void document.fonts?.ready.then(() => session.layout())
    return () => ro.disconnect()
  }, [id, active, visible])

  return (
    <div
      ref={ref}
      className={cn("absolute inset-0 py-1 pl-2", !active && "invisible")}
      data-testid="terminal"
      data-terminal-id={id}
    />
  )
}

function NewTerminal() {
  const info = useTerminalStore((s) => s.info)
  const [open, setOpen] = useState(false)
  const shells = info?.available ? info.shells : []
  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label="New terminal"
        title={shells[0] ? `New terminal (${shells[0].label})` : "New terminal"}
        disabled={info !== null && !info.available}
        onClick={() => void useTerminalStore.getState().add()}
        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-45"
      >
        <Plus className="size-3.5" />
      </button>
      {shells.length > 1 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="New terminal with a shell"
              className="flex h-6 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronDown className="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1 text-[12.5px]">
            {shells.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setOpen(false)
                  void useTerminalStore.getState().add(s.id)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
              >
                <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{s.label}</span>
                {i === 0 && <span className="text-[11px] text-muted-foreground">default</span>}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-[520px] text-[12.5px]">
        <p className="mb-1 font-medium">The terminal isn't available here.</p>
        <p className="text-muted-foreground">{reason}</p>
      </div>
    </div>
  )
}
