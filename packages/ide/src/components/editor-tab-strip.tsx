import { ChevronDown, ChevronLeft, ChevronRight, FileCode, Workflow, X } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface StripTab {
  id: string
  title: string
  /** Shown as the tooltip (usually the file path). */
  hint?: string | undefined
  /** Small muted text after the title, e.g. the folder when two tabs share a name. */
  detail?: string | undefined
  /** Picks the tab's icon. */
  kind?: "workflow" | "node" | undefined
  dirty?: boolean | undefined
}

interface Props {
  tabs: StripTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

const SCROLL_STEP = 200

/**
 * Editor tab strip. When the tabs don't fit, the strip scrolls without a
 * native scrollbar: arrow buttons appear on the side(s) with hidden tabs,
 * the edges fade, the mouse wheel scrolls sideways, the active tab is kept
 * in view, and a count button lists every open tab.
 */
export function EditorTabStrip({ tabs, activeId, onSelect, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 0)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    measure()
    el.addEventListener("scroll", measure, { passive: true })
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    ro?.observe(el)
    return () => {
      el.removeEventListener("scroll", measure)
      ro?.disconnect()
    }
  }, [measure])

  // Tabs opened, closed or renamed change the content width.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the tab list changes
  useLayoutEffect(measure, [tabs, measure])

  // Keep the active tab visible (opening a file, closing a neighbour).
  useEffect(() => {
    if (!activeId) return
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeId)}"]`,
    )
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  }, [activeId])

  // Vertical wheel scrolls the strip sideways, like other editors. React's
  // onWheel is passive, so this listener is attached by hand.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: "smooth" })
  const overflowing = canLeft || canRight

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
      {canLeft && (
        <ArrowButton label="Scroll tabs left" onClick={() => scrollBy(-SCROLL_STEP)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </ArrowButton>
      )}
      <div className="relative flex min-w-0 flex-1">
        <div
          ref={scrollRef}
          data-testid="editor-tab-strip"
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeId
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: middle-click to close; the tab's own controls are buttons
              <div
                key={tab.id}
                data-tab-id={tab.id}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    onClose(tab.id)
                  }
                }}
                className={cn(
                  "group flex shrink-0 items-center gap-1 border-r border-border pr-1.5 pl-3 text-[13px]",
                  active
                    ? "bg-background font-medium text-foreground shadow-[inset_0_2px_0_var(--primary)]"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  aria-current={active ? "page" : undefined}
                  title={tab.hint ?? tab.title}
                  onClick={() => onSelect(tab.id)}
                  className="flex h-full min-w-0 max-w-[18rem] items-center gap-2"
                >
                  <TabIcon kind={tab.kind} />
                  <span className="truncate">{tab.title}</span>
                  {tab.detail && (
                    <span aria-hidden className="truncate text-[11px] text-muted-foreground">
                      {tab.detail}
                    </span>
                  )}
                  {tab.dirty && <span className="sr-only"> •</span>}
                </button>
                <button
                  type="button"
                  onClick={() => onClose(tab.id)}
                  className="relative flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                  aria-label={`Close ${tab.title}`}
                >
                  {tab.dirty && (
                    <span
                      aria-hidden
                      className="absolute h-2 w-2 rounded-full bg-warning group-hover:hidden"
                    />
                  )}
                  <X
                    className={cn(
                      "h-3 w-3",
                      tab.dirty
                        ? "hidden group-hover:block"
                        : active
                          ? "opacity-70"
                          : "opacity-0 group-hover:opacity-70",
                    )}
                  />
                </button>
              </div>
            )
          })}
        </div>
        {canLeft && (
          <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent" />
        )}
        {canRight && (
          <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent" />
        )}
      </div>
      {canRight && (
        <ArrowButton label="Scroll tabs right" onClick={() => scrollBy(SCROLL_STEP)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </ArrowButton>
      )}
      {overflowing && (
        <Popover open={listOpen} onOpenChange={setListOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`All open tabs (${tabs.length})`}
              title="All open tabs"
              className="flex shrink-0 items-center gap-1 border-l border-border px-2.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {tabs.length}
              <ChevronDown className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-1.5">
            <ul className="max-h-80 overflow-y-auto">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(tab.id)
                      setListOpen(false)
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent",
                      tab.id === activeId && "bg-primary/10 text-foreground",
                    )}
                  >
                    <TabIcon kind={tab.kind} />
                    <span className="min-w-0 flex-1 truncate">
                      {tab.title}
                      {tab.detail && (
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {tab.detail}
                        </span>
                      )}
                    </span>
                    {tab.dirty && <span className="h-2 w-2 rounded-full bg-warning" />}
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function TabIcon({ kind }: { kind: StripTab["kind"] }) {
  if (kind === "workflow")
    return <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
  if (kind === "node") return <FileCode aria-hidden className="h-3.5 w-3.5 shrink-0 text-info" />
  return null
}

function ArrowButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex w-7 shrink-0 items-center justify-center border-x border-border text-foreground hover:bg-accent"
    >
      {children}
    </button>
  )
}
