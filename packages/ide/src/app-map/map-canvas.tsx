import { Maximize, Minus, Plus } from "lucide-react"
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { methodTone } from "@/panels/run-tab/method-tone"
import { resolveAccentColor } from "@/workflow/tailwind-colors"
import { nodeTint } from "@/workflow/workflow-node"
import {
  badgeWidth,
  type DisplayGraph,
  groupCountLabel,
  MONO_CHAR,
  type Shape,
  type ShapeEdge,
  workflowsIn,
} from "./display"
import type { AppMap, MapKind } from "./model"
import type { MapView } from "./prefs"

const LANE_TITLES: Record<MapKind, string> = {
  middleware: "Middleware",
  workflow: "Workflows",
  node: "Nodes",
  provider: "Providers",
}

export interface MapCanvasProps {
  map: AppMap
  graph: DisplayGraph
  view: MapView
  outlines: boolean
  laneX: Partial<Record<MapKind, number>> | null
  /** Shape keys to keep bright (hover or selection chain); null = nothing highlighted. */
  lit: Set<string> | null
  /** Shape keys matching the search; null = no search. */
  matches: Set<string> | null
  selectedShape: string | null
  selectedFolder: string | null
  /** Changes whenever the map should re-fit the screen. */
  fitToken: number
  /** Changes whenever shape positions moved. */
  frame: number
  onSelect(key: string | null): void
  onHover(key: string | null): void
  onMoved(): void
}

/** The colour an item or group is drawn in. */
export function shapeColor(s: Shape): string {
  const it = s.item
  if (it?.kind === "node") return nodeTint(`./${it.path.replace(/\.ts$/, "")}`, it.color)
  if (it?.kind === "provider")
    return it.color ? resolveAccentColor(it.color) : "var(--muted-foreground)"
  if (it?.kind === "middleware") return "var(--warning)"
  return "var(--muted-foreground)"
}

const hexPath = (r: number) => {
  const pts: string[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i
    pts.push(`${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r * 0.9).toFixed(2)}`)
  }
  return `M${pts.join("L")}Z`
}
const diamond = (r: number) => `M0,${-r}L${r},0L0,${r}L${-r},0Z`

/** Convex hull (monotone chain). */
function hull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0)
      upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

interface Outline {
  key: string
  path: string
  d: string
  labelX: number
  labelY: number
  leaf: boolean
  root: boolean
}

function folderOutlines(map: AppMap, graph: DisplayGraph, view: MapView): Outline[] {
  const height = new Map<string, number>()
  const h = (path: string): number => {
    const known = height.get(path)
    if (known !== undefined) return known
    const f = map.folders.get(path)
    const v = f?.children.length ? 1 + Math.max(...f.children.map(h)) : 0
    height.set(path, v)
    return v
  }
  const out: Outline[] = []
  const folders = [...map.folders.values()].sort(
    (a, b) => h(b.path) - h(a.path) || a.path.localeCompare(b.path),
  )
  for (const f of folders) {
    const root = f.depth === 1 && f.children.length > 0
    if (root && view === "graph") continue
    const shapes = [...new Set(f.members.map((m) => graph.rep.get(m)))].filter(
      (s): s is Shape => !!s && s.visible && !Number.isNaN(s.x),
    )
    if (!shapes.length) continue
    // A folder drawn as a single group bubble needs no outline of its own.
    if (shapes.length === 1 && shapes[0]?.key === f.key) continue
    const pad = 14 + h(f.path) * 13
    const pts: [number, number][] = []
    for (const s of shapes) {
      const cy = s.y + s.oy
      for (const [sx, sy] of [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ] as const) {
        for (let k = 0; k < 5; k++) {
          const a = Math.atan2(sy, sx) - Math.PI / 4 + (k / 4) * (Math.PI / 2)
          pts.push([
            s.x + sx * (s.hw - 6) + Math.cos(a) * (pad + 6),
            cy + sy * (s.hh - 6) + Math.sin(a) * (pad + 6),
          ])
        }
      }
    }
    const ring = hull(pts)
    if (ring.length < 3) continue
    out.push({
      key: f.key,
      path: f.path,
      d: `M${ring.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L")}Z`,
      labelX: Math.min(...ring.map((p) => p[0])) + 6,
      labelY: Math.min(...ring.map((p) => p[1])) - 7,
      leaf: h(f.path) === 0,
      root,
    })
  }
  return out
}

interface Transform {
  x: number
  y: number
  k: number
}

export function MapCanvas(props: MapCanvasProps) {
  const { map, graph, view, lit, matches, onSelect, onHover, onMoved } = props
  const svgRef = useRef<SVGSVGElement>(null)
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const tRef = useRef(t)
  tRef.current = t
  const animRef = useRef<number | null>(null)

  const fitView = useCallback(
    (animate: boolean) => {
      const el = svgRef.current
      const shown = graph.shapes.filter((s) => s.visible && !Number.isNaN(s.x))
      if (!el || !shown.length) return
      const W = el.clientWidth || 800
      const H = el.clientHeight || 600
      const x0 = Math.min(...shown.map((s) => s.x - s.hw)) - 60
      const x1 = Math.max(...shown.map((s) => s.x + s.hw)) + 60
      const y0 = Math.min(...shown.map((s) => s.y - s.hh)) - (view === "lanes" ? 110 : 70)
      const y1 = Math.max(...shown.map((s) => s.y + s.hh + s.oy)) + 50
      const k = Math.min(1.35, W / (x1 - x0), (H - 40) / (y1 - y0))
      const to = { k, x: W / 2 - (k * (x0 + x1)) / 2, y: (H + 30) / 2 - (k * (y0 + y1)) / 2 }
      if (animRef.current) cancelAnimationFrame(animRef.current)
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      if (!animate || reduce) {
        setT(to)
        return
      }
      const from = tRef.current
      const start = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / 400)
        const e = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
        setT({
          k: from.k + (to.k - from.k) * e,
          x: from.x + (to.x - from.x) * e,
          y: from.y + (to.y - from.y) * e,
        })
        animRef.current = p < 1 ? requestAnimationFrame(step) : null
      }
      animRef.current = requestAnimationFrame(step)
    },
    [graph, view],
  )

  const firstFit = useRef(true)
  /** True once the user pans or zooms; until then the map keeps fitting the screen. */
  const userMoved = useRef(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit only when asked
  useEffect(() => {
    fitView(!firstFit.current)
    firstFit.current = false
    userMoved.current = false
  }, [props.fitToken])

  // Keep fitting while the panel is resized, unless the user has moved the view.
  const fitRef = useRef(fitView)
  fitRef.current = fitView
  useEffect(() => {
    const el = svgRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) fitRef.current(false)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Wheel zoom around the pointer (a native listener, so it can stop the page scrolling).
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      userMoved.current = true
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      setT((cur) => {
        const k = Math.max(0.25, Math.min(3, cur.k * Math.exp(-e.deltaY * 0.0015)))
        return { k, x: px - ((px - cur.x) * k) / cur.k, y: py - ((py - cur.y) * k) / cur.k }
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  // Drag: the background pans; a shape moves in the graph layout. A press without movement is a click.
  const drag = useRef<{
    kind: "pan" | "shape"
    shape?: Shape
    sx: number
    sy: number
    ox: number
    oy: number
    moved: boolean
  } | null>(null)
  const onPointerDown = (e: ReactPointerEvent, shape?: Shape) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = shape
      ? {
          kind: "shape",
          shape,
          sx: e.clientX,
          sy: e.clientY,
          ox: shape.x,
          oy: shape.y,
          moved: false,
        }
      : { kind: "pan", sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, moved: false }
  }
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    d.moved = true
    userMoved.current = true
    if (d.kind === "pan") setT((cur) => ({ ...cur, x: d.ox + dx, y: d.oy + dy }))
    else if (d.shape && view === "graph") {
      d.shape.x = d.ox + dx / t.k
      d.shape.y = d.oy + dy / t.k
      onMoved()
    }
  }
  const onPointerUp = (shape?: Shape) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) onSelect(shape ? shape.key : null)
  }

  const zoomBy = (factor: number) => {
    userMoved.current = true
    const el = svgRef.current
    const W = el?.clientWidth ?? 800
    const H = el?.clientHeight ?? 600
    setT((cur) => {
      const k = Math.max(0.25, Math.min(3, cur.k * factor))
      return {
        k,
        x: W / 2 - ((W / 2 - cur.x) * k) / cur.k,
        y: H / 2 - ((H / 2 - cur.y) * k) / cur.k,
      }
    })
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: frame tracks moved positions
  const outlines = useMemo(
    () => (props.outlines ? folderOutlines(map, graph, view) : []),
    [map, graph, view, props.outlines, props.frame],
  )

  const shown = graph.shapes.filter((s) => s.visible && !Number.isNaN(s.x))
  const edgePath = (e: ShapeEdge) => {
    const a = graph.byKey.get(e.source)
    const b = graph.byKey.get(e.target)
    if (!a || !b || !a.visible || !b.visible || Number.isNaN(a.x) || Number.isNaN(b.x)) return null
    if (view === "lanes") {
      const x1 = a.x + (a.w ? a.w / 2 : 0)
      const x2 = b.x - (b.w ? b.w / 2 : 0)
      const mx = (x1 + x2) / 2
      return `M${x1},${a.y}C${mx},${a.y} ${mx},${b.y} ${x2},${b.y}`
    }
    return `M${a.x},${a.y}L${b.x},${b.y}`
  }
  const topY = shown.length ? Math.min(...shown.map((s) => s.y - s.hh)) : 0

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      <svg
        ref={svgRef}
        className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        role="img"
        aria-label="Application map"
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={() => onPointerUp()}
      >
        <defs>
          <pattern
            id="app-map-dots"
            width={22 * t.k}
            height={22 * t.k}
            x={t.x}
            y={t.y}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={1} cy={1} r={1} fill="var(--canvas-dot)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#app-map-dots)" />
        <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
          {view === "lanes" && props.laneX && (
            <g>
              {Object.entries(props.laneX).map(([kind, x]) => (
                <text
                  key={kind}
                  x={x}
                  y={topY - 86}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[11px] font-semibold uppercase tracking-[0.08em]"
                >
                  {LANE_TITLES[kind as MapKind]}
                </text>
              ))}
            </g>
          )}
          <g>
            {outlines.map((o) => {
              const on = props.selectedFolder === o.key
              return (
                <g key={o.key}>
                  <path
                    d={o.d}
                    fill="var(--foreground)"
                    fillOpacity={o.root ? 0 : o.leaf ? 0.035 : 0.028}
                    stroke={on ? "var(--primary)" : "var(--input)"}
                    strokeDasharray={on || o.leaf ? undefined : "4 4"}
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                  {/* biome-ignore lint/a11y/useSemanticElements: SVG text can't be a <button> */}
                  <text
                    role="button"
                    tabIndex={0}
                    aria-label={`Folder ${o.path}/`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        onSelect(o.key)
                      }
                    }}
                    x={o.labelX}
                    y={o.labelY}
                    className={`cursor-pointer font-mono text-[11px] hover:underline ${on ? "fill-primary" : "fill-muted-foreground hover:fill-foreground"}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onSelect(o.key)}
                    onPointerEnter={() => onHover(o.key)}
                    onPointerLeave={() => onHover(null)}
                  >
                    {o.path}/
                  </text>
                </g>
              )
            })}
          </g>
          <g fill="none">
            {[...graph.edges, ...graph.covers].map((e) => {
              const d = edgePath(e)
              if (!d) return null
              const on = !!lit && lit.has(e.source) && lit.has(e.target)
              if (e.type === "cover" && !on) return null
              const provider = graph.byKey.get(e.target)
              const width =
                Math.min(5, (e.type === "uses" ? 1.3 : 1.6) + (e.weight - 1) * 0.9) + (on ? 0.9 : 0)
              const stroke =
                e.type === "uses"
                  ? on
                    ? "var(--primary)"
                    : "var(--input)"
                  : e.type === "cover"
                    ? "var(--warning)"
                    : provider
                      ? shapeColor(provider)
                      : "var(--muted-foreground)"
              return (
                <path
                  key={`${e.source}|${e.target}|${e.type}`}
                  d={d}
                  stroke={stroke}
                  strokeWidth={width}
                  strokeDasharray={
                    e.type === "inject" ? "1.5 4" : e.type === "cover" ? "5 4" : undefined
                  }
                  strokeLinecap="round"
                  opacity={
                    lit && !on ? 0.13 : matches ? 0.13 : e.type === "inject" && !on ? 0.55 : 1
                  }
                  className="transition-opacity"
                />
              )
            })}
          </g>
          <g>
            {shown.map((s) => (
              <ShapeView
                key={s.key}
                shape={s}
                selected={props.selectedShape === s.key}
                match={!!matches?.has(s.key)}
                dim={(!!lit && !lit.has(s.key)) || (!!matches && !matches.has(s.key))}
                onPointerDown={(e) => onPointerDown(e, s)}
                onPointerUp={(e) => {
                  e.stopPropagation()
                  onPointerUp(s)
                }}
                onHover={onHover}
                onSelect={onSelect}
              />
            ))}
          </g>
        </g>
      </svg>
      <div className="absolute right-2.5 bottom-2.5 flex flex-col rounded-lg border border-border bg-popover p-0.5 shadow-md">
        {[
          { label: "Zoom in", icon: Plus, run: () => zoomBy(1.25) },
          { label: "Zoom out", icon: Minus, run: () => zoomBy(0.8) },
          { label: "Fit map to screen", icon: Maximize, run: () => fitView(true) },
        ].map(({ label, icon: Icon, run }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            onClick={run}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  )
}

const LABEL =
  "fill-foreground text-[11.5px] font-medium [paint-order:stroke] [stroke:var(--background)] [stroke-width:4px] [stroke-linejoin:round]"
const SUB =
  "fill-muted-foreground font-mono text-[10px] [paint-order:stroke] [stroke:var(--background)] [stroke-width:4px]"

function ShapeView({
  shape: s,
  selected,
  match,
  dim,
  onPointerDown,
  onPointerUp,
  onHover,
  onSelect,
}: {
  shape: Shape
  selected: boolean
  match: boolean
  dim: boolean
  onPointerDown(e: ReactPointerEvent): void
  onPointerUp(e: ReactPointerEvent): void
  onHover(key: string | null): void
  onSelect(key: string): void
}) {
  const color = shapeColor(s)
  const halo = (child: React.ReactNode) =>
    (selected || match) && (
      <g
        fill="none"
        stroke="var(--primary)"
        strokeWidth={2}
        strokeDasharray={selected ? undefined : "3 3"}
      >
        {child}
      </g>
    )
  let body: React.ReactNode
  const it = s.item
  if (s.kind === "workflow") {
    const mwKeys = workflowsIn(s)[0]?.middleware ?? []
    const mws = mwKeys.length
    let x = -s.w / 2 + 10
    const dots = mwKeys.map((mk) => {
      const d = (
        <path key={mk} d={`M${x + 3.5},-4L${x + 7},0L${x + 3.5},4L${x},0Z`} fill="var(--warning)" />
      )
      x += 9
      return d
    })
    if (mws) x += 6
    const method = it?.kind === "workflow" ? it.method : null
    let badge: React.ReactNode = null
    if (method) {
      const bw = badgeWidth(method)
      badge = (
        <g className={methodTone(method)}>
          <rect x={x} y={-9} width={bw} height={18} rx={4} fill="currentColor" fillOpacity={0.16} />
          <text
            x={x + bw / 2}
            y={3.5}
            textAnchor="middle"
            fill="currentColor"
            className="font-mono text-[10px] font-semibold"
          >
            {method}
          </text>
        </g>
      )
      x += bw + 8
    }
    body = (
      <>
        {halo(<rect x={-s.w / 2 - 4} y={-19} width={s.w + 8} height={38} rx={13} />)}
        {s.members && (
          <rect
            x={-s.w / 2 + 5}
            y={-20}
            width={s.w}
            height={30}
            rx={9}
            fill="var(--card)"
            stroke="var(--input)"
          />
        )}
        <rect
          x={-s.w / 2}
          y={-15}
          width={s.w}
          height={30}
          rx={9}
          fill="var(--card)"
          stroke="var(--input)"
        />
        {dots}
        {badge}
        <text x={x} y={4} className="fill-foreground font-mono text-[11.5px]">
          {it?.kind === "workflow" ? it.route : s.label}
        </text>
        {s.members && (
          <text
            x={x + s.label.length * MONO_CHAR + 10}
            y={4}
            className="fill-muted-foreground font-mono text-[10.5px]"
          >
            {groupCountLabel(s)}
          </text>
        )}
      </>
    )
  } else if (s.kind === "provider" && it?.kind === "provider") {
    body = (
      <>
        {halo(<path d={hexPath(s.r + 5)} />)}
        <path d={hexPath(s.r)} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.5} />
        <text
          y={s.r + 16}
          textAnchor="middle"
          className="fill-foreground font-mono text-[12px] font-semibold [paint-order:stroke] [stroke:var(--background)] [stroke-width:4px]"
        >
          {it.label}
        </text>
        <text y={s.r + 29} textAnchor="middle" className={SUB}>
          {it.info.lifetime}
        </text>
      </>
    )
  } else if (s.kind === "middleware" && it?.kind === "middleware") {
    body = (
      <>
        {halo(<path d={diamond(s.r + 5)} />)}
        <path
          d={diamond(s.r)}
          fill="color-mix(in srgb, var(--warning) 18%, var(--card))"
          stroke="var(--warning)"
          strokeWidth={1.5}
        />
        <text
          y={3.5}
          textAnchor="middle"
          fill="var(--warning)"
          className="font-mono text-[9.5px] font-semibold"
        >
          {it.order + 1}
        </text>
        <text y={s.r + 15} textAnchor="middle" className={LABEL}>
          {it.label}
        </text>
      </>
    )
  } else {
    // A node, or a folder group of nodes.
    body = s.members ? (
      <>
        {halo(<circle r={s.r + 4.5} />)}
        <circle cx={4} cy={-4} r={s.r} fill="var(--muted)" stroke="var(--input)" />
        <circle r={s.r} fill="var(--muted)" stroke="var(--muted-foreground)" strokeWidth={1.5} />
        <text
          y={4}
          textAnchor="middle"
          className="fill-foreground font-mono text-[12px] font-semibold"
        >
          {s.members.length}
        </text>
        <text y={s.r + 15} textAnchor="middle" className={`${LABEL} font-mono`}>
          {s.label}
        </text>
      </>
    ) : (
      <>
        {halo(<circle r={s.r + 4.5} />)}
        <circle r={s.r} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={1.5} />
        <text y={s.r + 15} textAnchor="middle" className={LABEL}>
          {s.label}
        </text>
      </>
    )
  }
  const name = s.members
    ? `Folder ${s.folder}/ with ${groupCountLabel(s)}`
    : `${s.kind === "workflow" ? "Workflow" : s.kind === "node" ? "Node" : s.kind === "provider" ? "Provider" : "Middleware"}: ${s.label}`
  return (
    // biome-ignore lint/a11y/useSemanticElements: an SVG group can't be a <button>
    <g
      role="button"
      tabIndex={0}
      aria-label={name}
      aria-pressed={selected}
      transform={`translate(${s.x},${s.y})`}
      className="cursor-pointer outline-none transition-opacity focus-visible:[&>*]:opacity-90"
      opacity={dim ? 0.13 : 1}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerEnter={() => onHover(s.key)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(s.key)}
      onBlur={() => onHover(null)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onSelect(s.key)
        }
      }}
    >
      <title>{s.members ? s.members.map((m) => m.label).join(", ") : (it?.path ?? s.label)}</title>
      {body}
    </g>
  )
}
