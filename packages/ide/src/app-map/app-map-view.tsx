import { Eye, Network, X } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { buildDisplay, type DisplayGraph, type Measure } from "./display"
import { graphLayout, lanesLayout, type Positions } from "./layout"
import { MapCanvas } from "./map-canvas"
import { MapInspector } from "./map-inspector"
import { MapSidebar } from "./map-sidebar"
import { type AppMap, connectedTo, type MapKind, matchesQuery, visibleKeys } from "./model"
import { type MapView, useAppMapPrefs } from "./prefs"
import { useAppMap } from "./use-app-map"

const ALL_KINDS: MapKind[] = ["workflow", "node", "middleware", "provider"]
/** Below this width the details column only shows while something is selected. */
const NARROW = 980
const ANIMATE_MS = 450

/** Label width in the map's font; a character estimate where there's no canvas (tests). */
function makeMeasure(): Measure {
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = document.createElement("canvas").getContext("2d")
  } catch {
    ctx = null
  }
  if (!ctx) return (text) => text.length * 6.3
  ctx.font = '500 11.5px "IBM Plex Sans", sans-serif'
  const c = ctx
  return (text) => c.measureText(text).width
}

/** The Application map: every route, node, middleware and provider, and how they connect. */
export function AppMapView({ onClose }: { onClose?: () => void }) {
  const { map, loaded } = useAppMap()
  if (!loaded || !map.items.length) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex min-h-11 items-center gap-2 border-b border-border bg-card px-3">
          <MapTitle />
          <span className="flex-1" />
          {onClose && <CloseButton onClose={onClose} />}
        </div>
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          {loaded
            ? "Nothing to map yet. Add a workflow or a node and it shows up here."
            : "Loading the map…"}
        </div>
      </div>
    )
  }
  return <AppMapLoaded map={map} onClose={onClose} />
}

function MapTitle() {
  return (
    <h2 className="flex items-center gap-2 pr-2 text-[13px] font-semibold">
      <Network className="h-4 w-4 text-primary" aria-hidden="true" />
      Application map
    </h2>
  )
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      aria-label="Close the map"
      title="Close (Esc)"
      onClick={onClose}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <X className="h-4 w-4" />
    </button>
  )
}

function AppMapLoaded({ map, onClose }: { map: AppMap; onClose?: (() => void) | undefined }) {
  const view = useAppMapPrefs((s) => s.view)
  const setView = useAppMapPrefs((s) => s.setView)
  const group = useAppMapPrefs((s) => s.group)
  const setGroup = useAppMapPrefs((s) => s.setGroup)
  const outlines = useAppMapPrefs((s) => s.outlines[s.view])
  const setOutlines = useAppMapPrefs((s) => s.setOutlines)

  const [kinds, setKinds] = useState<Set<MapKind>>(() => new Set(ALL_KINDS))
  const [focus, setFocus] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [frame, setFrame] = useState(0)
  const [fitToken, setFitToken] = useState(0)
  const [laneX, setLaneX] = useState<Partial<Record<MapKind, number>> | null>(null)

  const measure = useMemo(makeMeasure, [])
  const visible = useMemo(() => visibleKeys(map, kinds, focus), [map, kinds, focus])
  const graph = useMemo(
    () => buildDisplay(map, { group, visible, measure }),
    [map, group, visible, measure],
  )

  // Where each shape was last drawn, and where the graph layout last left it
  // (so switching views, or dragging, isn't undone by the next re-layout).
  const lastPos = useRef<Positions>(new Map())
  const graphPos = useRef<Positions>(new Map())
  const graphLaidOutFor = useRef<DisplayGraph | null>(null)

  const onMoved = useCallback(() => {
    for (const s of graph.shapes) {
      if (!s.visible || Number.isNaN(s.x)) continue
      graphPos.current.set(s.key, { x: s.x, y: s.y })
      lastPos.current.set(s.key, { x: s.x, y: s.y })
    }
    setFrame((f) => f + 1)
  }, [graph])

  // Re-lay out whatever is shown whenever the shown set or the view changes.
  useLayoutEffect(() => {
    const shown = graph.shapes.filter((s) => s.visible)
    let targets: Positions
    if (view === "lanes") {
      const result = lanesLayout(graph)
      targets = result.positions
      setLaneX(result.laneX)
    } else if (
      graphLaidOutFor.current === graph &&
      shown.every((s) => graphPos.current.has(s.key))
    ) {
      targets = graphPos.current
    } else {
      const now = new Map(shown.map((s) => [s.key, { x: s.x, y: s.y }]))
      const seeded = shown.filter((s) => graphPos.current.has(s.key))
      for (const s of shown) {
        const p = graphPos.current.get(s.key)
        if (p) {
          s.x = p.x
          s.y = p.y
        }
      }
      // A fresh start for the first layout; a gentler nudge once most of it is placed.
      targets = graphLayout(graph, { alpha: seeded.length > shown.length / 2 ? 0.6 : 1 })
      for (const s of shown) {
        const p = now.get(s.key)
        if (p) {
          s.x = p.x
          s.y = p.y
        }
      }
      graphPos.current = new Map([...graphPos.current, ...targets])
      graphLaidOutFor.current = graph
    }

    const moves = shown.flatMap((s) => {
      const to = targets.get(s.key)
      if (!to) return []
      const from = Number.isNaN(s.x) ? lastPos.current.get(s.key) : { x: s.x, y: s.y }
      return [{ s, from, to }]
    })
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const finish = () => {
      for (const { s, to } of moves) {
        s.x = to.x
        s.y = to.y
        lastPos.current.set(s.key, to)
      }
      setFrame((f) => f + 1)
      setFitToken((t) => t + 1)
    }
    if (reduce || moves.every((m) => !m.from)) {
      finish()
      return
    }
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / ANIMATE_MS)
      const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
      if (p >= 1) {
        finish()
        return
      }
      for (const { s, from, to } of moves) {
        const f = from ?? to
        s.x = f.x + (to.x - f.x) * e
        s.y = f.y + (to.y - f.y) * e
      }
      setFrame((n) => n + 1)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      // Land where it was going so the next layout starts from a settled map.
      for (const { s, to } of moves) {
        s.x = to.x
        s.y = to.y
        lastPos.current.set(s.key, to)
      }
    }
  }, [graph, view])

  const toShapes = useCallback(
    (keys: Iterable<string>) => {
      const out = new Set<string>()
      for (const k of keys) {
        const s = graph.rep.get(k)
        if (s) out.add(s.key)
      }
      return out
    },
    [graph],
  )
  const active = hover ?? selected
  const lit = useMemo(() => {
    if (!active) return null
    const keys = toShapes(connectedTo(map, active))
    if (graph.byKey.has(active)) keys.add(active)
    return keys
  }, [active, map, graph, toShapes])
  const matchingItems = useMemo(
    () =>
      query.trim() ? map.items.filter((i) => visible.has(i.key) && matchesQuery(i, query)) : null,
    [query, map, visible],
  )
  const matches = useMemo(
    () => (matchingItems ? toShapes(matchingItems.map((i) => i.key)) : null),
    [matchingItems, toShapes],
  )

  const selectedShape = selected
    ? graph.byKey.has(selected)
      ? selected
      : (graph.rep.get(selected)?.key ?? null)
    : null
  const selectedFolder = selected?.startsWith("folder:") ? selected : null

  const toggleFocus = (key: string) =>
    setFocus((cur) => {
      const next = new Set(cur)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleKind = (kind: MapKind) =>
    setKinds((cur) => {
      const next = new Set(cur)
      if (next.has(kind)) next.delete(kind)
      else next.add(kind)
      return next
    })

  const rootRef = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(([entry]) =>
      setNarrow((entry?.contentRect.width ?? NARROW) < NARROW),
    )
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const showInspector = !narrow || selected !== null

  const focusLabel = (key: string) =>
    key.startsWith("folder:") ? `${key.slice(7)}/` : (map.byKey.get(key)?.label ?? key)

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        <MapTitle />
        <div
          role="tablist"
          aria-label="Layout"
          className="flex rounded-md border border-border bg-muted p-0.5"
        >
          {(["lanes", "graph"] as MapView[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "h-6 rounded px-2.5 text-[12px]",
                view === v
                  ? "bg-background font-medium text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "lanes" ? "Lanes" : "Graph"}
            </button>
          ))}
        </div>
        {focus.size > 0 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-muted-foreground">Focused on</span>
            {[...focus].map((k) => (
              <span
                key={k}
                className="flex h-6 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pr-1 pl-2 text-[12px]"
              >
                <span className="max-w-48 truncate">{focusLabel(k)}</span>
                <button
                  type="button"
                  aria-label={`Stop focusing on ${focusLabel(k)}`}
                  onClick={() => toggleFocus(k)}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => setFocus(new Set())}
              className="text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
        <span className="flex-1" />
        <span
          className="flex h-6 items-center gap-1 rounded-full border border-border px-2 text-[11.5px] text-muted-foreground"
          title="This map can't change your project. Open a file to edit it."
        >
          <Eye className="h-3 w-3" />
          Read-only
        </span>
        {onClose && <CloseButton onClose={onClose} />}
      </div>
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: showInspector ? "250px minmax(0,1fr) 290px" : "250px minmax(0,1fr)",
        }}
      >
        <MapSidebar
          map={map}
          view={view}
          query={query}
          onQuery={setQuery}
          kinds={kinds}
          onToggleKind={toggleKind}
          focus={focus}
          onToggleFocus={toggleFocus}
          group={group}
          onGroup={setGroup}
          outlines={outlines}
          onOutlines={(on) => setOutlines(view, on)}
          onHover={setHover}
          onSubmitQuery={() => {
            const first = matchingItems?.[0]
            if (first) setSelected(first.key)
          }}
        />
        <MapCanvas
          map={map}
          graph={graph}
          view={view}
          outlines={outlines}
          laneX={view === "lanes" ? laneX : null}
          lit={lit}
          matches={matches}
          selectedShape={selectedShape}
          selectedFolder={selectedFolder}
          fitToken={fitToken}
          frame={frame}
          onSelect={setSelected}
          onHover={setHover}
          onMoved={onMoved}
        />
        {showInspector && (
          <MapInspector
            map={map}
            selected={selected}
            focused={!!selected && focus.has(selected)}
            onSelect={setSelected}
            onToggleFocus={toggleFocus}
            onHover={setHover}
          />
        )}
      </div>
    </div>
  )
}
