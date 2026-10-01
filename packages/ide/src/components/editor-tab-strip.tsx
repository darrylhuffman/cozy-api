import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCode,
  GitCompare,
  Network,
  Workflow,
  X,
} from "lucide-react"
import { ContextMenu } from "radix-ui"
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
  kind?: "workflow" | "node" | "diff" | "map" | undefined
  dirty?: boolean | undefined
}

interface Props {
  tabs: StripTab[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  /** Rendered after the tabs, e.g. a "new tab" button. */
  trailing?: React.ReactNode
  /** Accessible name for a tab's close button; defaults to "Close <title>". */
  closeLabel?: (tab: StripTab) => string
  /**
   * Closes several tabs at once. When set, right-clicking a tab offers
   * Close, Close others, Close to the right, Close saved and Close all.
   */
  onCloseMany?: (ids: string[]) => void
  /** When set, tabs can be dragged to a new position (`toIndex` after the move). */
  onReorder?: (id: string, toIndex: number) => void
}

const DRAG_TYPE = "application/lorien-tab"

const SCROLL_STEP = 200

/**
 * Editor tab strip. When the tabs don't fit, the strip scrolls without a
 * native scrollbar: arrow buttons appear on the side(s) with hidden tabs,
 * the edges fade, the mouse wheel scrolls sideways, the active tab is kept
 * in view, and a count button lists every open tab.
 */
export function EditorTabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  trailing,
  closeLabel,
  onCloseMany,
  onReorder,
}: Props) {
  const [dragId, setDragId] = useState<string | null>(null)
  // Insertion point while dragging: before tab `index` (tabs.length = at the end).
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const endDrag = () => {
    setDragId(null)
    setDropIndex(null)
  }
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
          {tabs.map((tab, index) => {
            const active = tab.id === activeId
            const tabEl = (
              // biome-ignore lint/a11y/noStaticElementInteractions: middle-click to close and drag to reorder; the tab's own controls are buttons
              <div
                key={tab.id}
                data-tab-id={tab.id}
                draggable={onReorder !== undefined}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, tab.id)
                  e.dataTransfer.effectAllowed = "move"
                  setDragId(tab.id)
                }}
                onDragOver={(e) => {
                  if (!dragId) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = "move"
                  const r = e.currentTarget.getBoundingClientRect()
                  setDropIndex(e.clientX < r.left + r.width / 2 ? index : index + 1)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (dragId && dropIndex !== null && onReorder) {
                    const from = tabs.findIndex((t) => t.id === dragId)
                    // Removing the dragged tab shifts later positions left by one.
                    const to = dropIndex > from ? dropIndex - 1 : dropIndex
                    if (to !== from) onReorder(dragId, to)
                  }
                  endDrag()
                }}
                onDragEnd={endDrag}
                onMouseDown={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    onClose(tab.id)
                  }
                }}
                className={cn(
                  "group relative flex shrink-0 items-center gap-1 border-r border-border pr-1.5 pl-3 text-[13px]",
                  active
                    ? "bg-background font-medium text-foreground shadow-[inset_0_2px_0_var(--primary)]"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  dragId === tab.id && "opacity-50",
                )}
              >
                {dropIndex === index && dragId && <DropMarker side="left" />}
                {dropIndex === index + 1 && index === tabs.length - 1 && dragId && (
                  <DropMarker side="right" />
                )}
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
                  aria-label={closeLabel ? closeLabel(tab) : `Close ${tab.title}`}
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
            if (!onCloseMany) return tabEl
            return (
              <TabMenu
                key={tab.id}
                tab={tab}
                index={index}
                tabs={tabs}
                onClose={onClose}
                onCloseMany={onCloseMany}
                onSelect={onSelect}
              >
                {tabEl}
              </TabMenu>
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
      {trailing}
    </div>
  )
}

/** Where a dragged tab will land. */
function DropMarker({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-primary",
        side === "left" ? "-left-px" : "-right-px",
      )}
    />
  )
}

const MENU_ITEM =
  "flex cursor-default items-center rounded-sm px-2 py-1.5 text-[13px] outline-none select-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"

function TabMenu({
  tab,
  index,
  tabs,
  onClose,
  onCloseMany,
  onSelect,
  children,
}: {
  tab: StripTab
  index: number
  tabs: StripTab[]
  onClose: (id: string) => void
  onCloseMany: (ids: string[]) => void
  onSelect: (id: string) => void
  children: React.ReactNode
}) {
  const others = tabs.filter((t) => t.id !== tab.id).map((t) => t.id)
  const toRight = tabs.slice(index + 1).map((t) => t.id)
  const saved = tabs.filter((t) => !t.dirty).map((t) => t.id)
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          aria-label={`${tab.title} tab`}
          className="z-50 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <ContextMenu.Item className={MENU_ITEM} onSelect={() => onClose(tab.id)}>
            Close
          </ContextMenu.Item>
          <ContextMenu.Item
            className={MENU_ITEM}
            disabled={others.length === 0}
            onSelect={() => {
              onSelect(tab.id)
              onCloseMany(others)
            }}
          >
            Close others
          </ContextMenu.Item>
          <ContextMenu.Item
            className={MENU_ITEM}
            disabled={toRight.length === 0}
            onSelect={() => onCloseMany(toRight)}
          >
            Close to the right
          </ContextMenu.Item>
          <ContextMenu.Item
            className={MENU_ITEM}
            disabled={saved.length === 0}
            onSelect={() => onCloseMany(saved)}
          >
            Close saved
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-border" />
          <ContextMenu.Item
            className={MENU_ITEM}
            onSelect={() => onCloseMany(tabs.map((t) => t.id))}
          >
            Close all
          </ContextMenu.Item>
          {tab.hint && (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
              <ContextMenu.Item
                className={MENU_ITEM}
                onSelect={() => void navigator.clipboard?.writeText(tab.hint ?? "")}
              >
                Copy path
              </ContextMenu.Item>
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

function TabIcon({ kind }: { kind: StripTab["kind"] }) {
  if (kind === "workflow")
    return <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
  if (kind === "node") return <FileCode aria-hidden className="h-3.5 w-3.5 shrink-0 text-info" />
  if (kind === "diff")
    return <GitCompare aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />
  if (kind === "map") return <Network aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
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
