import {
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force"
import type { DisplayGraph, Shape, ShapeEdge } from "./display"
import type { MapKind, MiddlewareItem } from "./model"

export type Positions = Map<string, { x: number; y: number }>

/** Lane order, left to right. */
export const LANES: MapKind[] = ["middleware", "workflow", "node", "provider"]
const LANE_GAP = 150
const FOLDER_GAP = 44

export interface LanesResult {
  positions: Positions
  /** Centre x of each lane that has something in it. */
  laneX: Partial<Record<MapKind, number>>
}

/**
 * Columns: Middleware | Workflows | Nodes | Providers, using only what is
 * shown. Folders stay together as blocks; within that, every shape is moved
 * as close as it can get to the rows of the things it connects to, so a
 * straight path (GET /hello → Say Hello) sits on one row.
 */
export function lanesLayout(graph: DisplayGraph): LanesResult {
  const cols: Record<MapKind, Shape[]> = { middleware: [], workflow: [], node: [], provider: [] }
  for (const s of graph.shapes) if (s.visible) cols[s.kind].push(s)
  const sortKey = (s: Shape) => {
    const order = s.item?.kind === "middleware" ? String((s.item as MiddlewareItem).order) : s.label
    return `${s.folder}/\u0000${order}`
  }
  const laneX: Partial<Record<MapKind, number>> = {}
  let x = 0
  for (const k of LANES) {
    const col = cols[k]
    if (!col.length) continue
    col.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
    const width = Math.max(60, ...col.map((s) => s.hw * 2))
    laneX[k] = x + width / 2
    x += width + LANE_GAP
  }

  // Start compact, folder by folder.
  const pos: Positions = new Map()
  for (const k of LANES) {
    let y = 0
    let last: string | null = null
    for (const s of cols[k]) {
      if (last !== null && s.folder !== last) y += FOLDER_GAP
      y += s.hh
      pos.set(s.key, { x: laneX[k] ?? 0, y })
      y += s.hh + spacingFor(k)
      last = s.folder
    }
  }

  const neighbours = new Map<string, string[]>(graph.shapes.map((s) => [s.key, []]))
  for (const e of graph.edges) {
    neighbours.get(e.source)?.push(e.target)
    neighbours.get(e.target)?.push(e.source)
  }
  const target = (s: Shape): number => {
    const own = pos.get(s.key)?.y ?? 0
    if (s.item?.kind === "middleware") {
      // Level with the first route it guards: it reads as the gate in front of its folder.
      const ys = s.item.covers.map((w) => pos.get(graph.rep.get(w)?.key ?? "")?.y).filter(isNum)
      return ys.length ? Math.min(...ys) : own
    }
    const ys = (neighbours.get(s.key) ?? []).map((n) => pos.get(n)?.y).filter(isNum)
    return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : own
  }
  for (let round = 0; round < 5; round++) {
    for (const k of ["node", "provider", "workflow", "middleware"] as MapKind[])
      placeColumn(cols[k], k, target, pos)
  }
  for (const k of ["node", "provider", "middleware"] as MapKind[])
    placeColumn(cols[k], k, target, pos)
  return { positions: pos, laneX }
}

const isNum = (v: number | undefined): v is number => typeof v === "number"
const spacingFor = (k: MapKind) => (k === "workflow" ? 16 : 18)

/**
 * Puts each shape as close to its target row as possible without overlaps:
 * folder blocks ordered by their average target, shapes within a block by
 * theirs, then overlapping runs merged and centred on their targets.
 */
function placeColumn(col: Shape[], kind: MapKind, target: (s: Shape) => number, pos: Positions) {
  if (!col.length) return
  const x = pos.get(col[0]?.key ?? "")?.x ?? 0
  const want = new Map(col.map((s) => [s.key, target(s)]))
  const blocks = new Map<string, Shape[]>()
  for (const s of col) blocks.set(s.folder, [...(blocks.get(s.folder) ?? []), s])
  const ordered = [...blocks.values()]
    .map((xs) => ({
      xs: xs.sort((a, b) => (want.get(a.key) ?? 0) - (want.get(b.key) ?? 0)),
      mean: xs.reduce((a, s) => a + (want.get(s.key) ?? 0), 0) / xs.length,
    }))
    .sort((a, b) => a.mean - b.mean)
  const seq: { s: Shape; off: number; t: number }[] = []
  let off = 0
  ordered.forEach((block, bi) => {
    block.xs.forEach((s, i) => {
      const prev = seq[seq.length - 1]
      if (prev) off += prev.s.hh + spacingFor(kind) + (i === 0 && bi > 0 ? FOLDER_GAP : 0) + s.hh
      seq.push({ s, off, t: (want.get(s.key) ?? 0) - off })
    })
  })
  // Pool adjacent violators: all positions share the offsets, so a later run
  // overlaps an earlier one exactly when its start is above the earlier start.
  const runs: { items: typeof seq; p: number }[] = []
  for (const e of seq) {
    runs.push({ items: [e], p: e.t })
    while (runs.length > 1) {
      const cur = runs[runs.length - 1]
      const prev = runs[runs.length - 2]
      if (!cur || !prev || cur.p >= prev.p) break
      prev.items.push(...cur.items)
      prev.p = prev.items.reduce((a, i) => a + i.t, 0) / prev.items.length
      runs.pop()
    }
  }
  for (const run of runs) for (const e of run.items) pos.set(e.s.key, { x, y: run.p + e.off })
}

interface SimNode extends SimulationNodeDatum {
  shape: Shape
}

/**
 * A force layout driven by connections: links pull connected shapes
 * together, shapes of different kinds push apart a little, shapes that share
 * folders pull together (more for deeper shared folders), and boxes never
 * overlap. Starts from the shapes' current positions when they have them.
 */
export function graphLayout(
  graph: DisplayGraph,
  opts: { alpha?: number; ticks?: number } = {},
): Positions {
  const shown = graph.shapes.filter((s) => s.visible)
  const on = new Set(shown.map((s) => s.key))
  const nodes: SimNode[] = shown.map((shape) =>
    Number.isNaN(shape.x) ? { shape } : { shape, x: shape.x, y: shape.y },
  )
  const links = [...graph.edges, ...graph.covers]
    .filter((e) => on.has(e.source) && on.has(e.target))
    .map((e) => ({ ...e }))
  const degree = new Map(shown.map((s) => [s.key, 0]))
  for (const l of links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
  }
  type Link = ShapeEdge & { source: string | SimNode; target: string | SimNode }
  const keyOf = (end: string | SimNode) => (typeof end === "string" ? end : end.shape.key)
  const sim = forceSimulation(nodes)
    .force(
      "link",
      forceLink<SimNode, Link>(links)
        .id((d) => d.shape.key)
        .distance((l) => (l.type === "cover" ? 190 : 135))
        .strength(
          (l) =>
            ((l.type === "cover" ? 0.12 : 1) * Math.min(1, l.weight * 0.6)) /
            Math.max(
              1,
              Math.min(degree.get(keyOf(l.source)) ?? 1, degree.get(keyOf(l.target)) ?? 1),
            ),
        ),
    )
    .force("charge", forceManyBody<SimNode>().strength(-460).distanceMax(800))
    .force("x", forceX<SimNode>(0).strength(0.05))
    .force("y", forceY<SimNode>(0).strength(0.07))
    .force("kinds", forceKinds(260, 0.5))
    .force("folders", forceFolders(0.06))
    .force("boxes", forceBoxes(14))
    .stop()
  sim.alpha(opts.alpha ?? 1)
  for (let i = 0; i < (opts.ticks ?? 500); i++) sim.tick()
  return new Map(nodes.map((n) => [n.shape.key, { x: n.x ?? 0, y: n.y ?? 0 }]))
}

type Force = ((alpha: number) => void) & { initialize: (nodes: SimNode[]) => void }

/** Shapes of different kinds push apart when closer than `range`. */
function forceKinds(range: number, strength: number): Force {
  let nodes: SimNode[] = []
  const f = ((alpha: number) => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i] as SimNode
        const b = nodes[j] as SimNode
        if (a.shape.kind === b.shape.kind) continue
        let dx = (b.x ?? 0) - (a.x ?? 0)
        let dy = (b.y ?? 0) - (a.y ?? 0)
        const d = Math.hypot(dx, dy) || 1
        if (d >= range) continue
        const k = ((range - d) / d) * strength * alpha * 0.5
        dx *= k
        dy *= k
        a.vx = (a.vx ?? 0) - dx
        a.vy = (a.vy ?? 0) - dy
        b.vx = (b.vx ?? 0) + dx
        b.vy = (b.vy ?? 0) + dy
      }
    }
  }) as Force
  f.initialize = (n) => {
    nodes = n
  }
  return f
}

/** Number of leading folders two paths share ("nodes/orders" and "nodes/events" share 1). */
export function sharedDepth(a: string, b: string): number {
  const x = a.split("/")
  const y = b.split("/")
  let n = 0
  while (n < x.length && n < y.length && x[n] === y[n]) n++
  return n
}

/**
 * Shapes in the same folders pull together. Sharing only the top folder
 * (nodes/, workflows/) gives no pull; each deeper shared folder adds more.
 */
function forceFolders(strength: number): Force {
  let pairs: [SimNode, SimNode, number][] = []
  const f = ((alpha: number) => {
    for (const [a, b, w] of pairs) {
      const dx = (b.x ?? 0) - (a.x ?? 0)
      const dy = (b.y ?? 0) - (a.y ?? 0)
      if (Math.hypot(dx, dy) < 50) continue
      const k = w * strength * alpha
      a.vx = (a.vx ?? 0) + dx * k
      a.vy = (a.vy ?? 0) + dy * k
      b.vx = (b.vx ?? 0) - dx * k
      b.vy = (b.vy ?? 0) - dy * k
    }
  }) as Force
  f.initialize = (n) => {
    pairs = []
    for (let i = 0; i < n.length; i++) {
      for (let j = i + 1; j < n.length; j++) {
        const a = n[i] as SimNode
        const b = n[j] as SimNode
        if (a.shape.kind === "provider" || b.shape.kind === "provider") continue
        const shared = sharedDepth(a.shape.folder, b.shape.folder)
        if (shared > 1) pairs.push([a, b, 1 + (shared - 2) * 1.5])
      }
    }
  }
  return f
}

/** Pushes overlapping boxes apart along the shorter overlap. */
function forceBoxes(margin: number): Force {
  let nodes: SimNode[] = []
  const f = ((_alpha: number) => {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i] as SimNode
        const b = nodes[j] as SimNode
        const dx = (b.x ?? 0) - (a.x ?? 0)
        const dy = (b.y ?? 0) + b.shape.oy - ((a.y ?? 0) + a.shape.oy)
        const ox = a.shape.hw + b.shape.hw + margin - Math.abs(dx)
        const oy = a.shape.hh + b.shape.hh + margin - Math.abs(dy)
        if (ox <= 0 || oy <= 0) continue
        if (ox < oy) {
          const s = (dx < 0 ? -1 : 1) * ox * 0.5
          a.x = (a.x ?? 0) - s
          b.x = (b.x ?? 0) + s
        } else {
          const s = (dy < 0 ? -1 : 1) * oy * 0.5
          a.y = (a.y ?? 0) - s
          b.y = (b.y ?? 0) + s
        }
      }
    }
  }) as Force
  f.initialize = (n) => {
    nodes = n
  }
  return f
}
