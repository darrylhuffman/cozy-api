import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface StripTab {
  id: string
  title: string
  /** Shown as the tooltip (usually the file path). */
  hint?: string | undefined
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
 * the mouse wheel scrolls sideways, and the active tab is kept in view.
 */
export function EditorTabStrip({ tabs, activeId, onSelect, onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

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

  return (
    <div className="flex shrink-0 items-stretch border-b border-border bg-muted/30">
      {canLeft && (
        <ArrowButton label="Scroll tabs left" onClick={() => scrollBy(-SCROLL_STEP)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </ArrowButton>
      )}
      <div
        ref={scrollRef}
        data-testid="editor-tab-strip"
        className="flex min-w-0 flex-1 items-center gap-px overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                "group flex shrink-0 items-center gap-2 border-r border-border px-3 py-1.5 text-sm",
                active ? "bg-muted" : "bg-background",
              )}
            >
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                title={tab.hint ?? tab.title}
                onClick={() => onSelect(tab.id)}
                className={cn(
                  "max-w-[16rem] min-w-0 truncate",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.title}
                {tab.dirty && <span className="ml-1 text-muted-foreground">&bull;</span>}
              </button>
              <button
                type="button"
                onClick={() => onClose(tab.id)}
                className="rounded-sm p-0.5 text-muted-foreground opacity-60 hover:bg-accent hover:opacity-100"
                aria-label={`Close ${tab.title}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>
      {canRight && (
        <ArrowButton label="Scroll tabs right" onClick={() => scrollBy(SCROLL_STEP)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </ArrowButton>
      )}
    </div>
  )
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
      className="flex w-6 shrink-0 items-center justify-center border-x border-border bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}
