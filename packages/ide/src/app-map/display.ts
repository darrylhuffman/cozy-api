import type { AppMap, MapItem, MapKind, MiddlewareItem, WorkflowItem } from "./model"

/**
 * What the map draws: one shape per item, or (with "Group by folder") one
 * bubble per folder of workflows or nodes. Holds each shape's size and
 * position; layouts write `x`/`y`.
 */
export interface Shape {
  /** The item's key, or the folder's ("folder:nodes/pets") for a group. */
  key: string
  kind: MapKind
  folder: string
  item?: MapItem
  /** Set for a folder group: the items it stands for. */
  members?: MapItem[]
  /** Text drawn for it (route, node name, folder name…). */
  label: string
  /** Half width / half height of its box, centred `oy` below (x, y). Used for spacing and outlines. */
  hw: number
  hh: number
  oy: number
  /** Pill width for workflows and workflow groups, circle/hexagon radius for the rest. */
  w: number
  r: number
  x: number
  y: number
  visible: boolean
}

export interface ShapeEdge {
  source: string
  target: string
  type: "uses" | "inject" | "cover"
  /** How many item-level connections it stands for (more than 1 when grouped). */
  weight: number
}

export interface DisplayGraph {
  shapes: Shape[]
  byKey: Map<string, Shape>
  /** Item key → the shape drawing it. */
  rep: Map<string, Shape>
  edges: ShapeEdge[]
  /** Middleware → each workflow it runs in front of (drawn on hover). */
  covers: ShapeEdge[]
}

/** Measures text in the map's label font (IBM Plex Sans 11.5px). */
export type Measure = (text: string) => number

/** Width of one JetBrains Mono character at 11.5px (the face is 0.6em wide). */
export const MONO_CHAR = 6.9
const mono = (text: string, px = 11.5) => text.length * px * 0.6
/** Width of a method badge ("POST"). */
export const badgeWidth = (method: string) => mono(method, 10) + 10

/** Unique per map so a folder group keeps its position when toggled off and on. */
const groupCache = new WeakMap<AppMap, Map<string, Shape>>()

export function workflowsIn(s: Shape): WorkflowItem[] {
  if (s.members) return s.members.filter((m): m is WorkflowItem => m.kind === "workflow")
  return s.item?.kind === "workflow" ? [s.item] : []
}

function sizeItem(it: MapItem, measure: Measure): Pick<Shape, "hw" | "hh" | "oy" | "w" | "r"> {
  if (it.kind === "workflow") {
    const mwW = it.middleware.length ? it.middleware.length * 9 + 6 : 0
    const badgeW = it.method ? badgeWidth(it.method) + 8 : 0
    const w = 10 + mwW + badgeW + mono(it.route) + 12
    return { w, hw: w / 2, hh: 15, oy: 0, r: 0 }
  }
  const labW = it.kind === "provider" ? mono(it.label, 12) : measure(it.label)
  if (it.kind === "node") {
    const r = 8 + Math.min(new Set(it.usedBy.map((u) => u.workflow)).size, 4) * 2.5
    return { r, w: 0, hw: Math.max(r, labW / 2 + 4), hh: r + 10, oy: 8 }
  }
  if (it.kind === "provider") return { r: 17, w: 0, hw: Math.max(17, labW / 2 + 4), hh: 29, oy: 10 }
  return { r: 11, w: 0, hw: Math.max(11, labW / 2 + 4), hh: 21, oy: 8 }
}

export function groupCountLabel(s: Shape): string {
  const n = s.members?.length ?? 0
  return s.kind === "workflow" ? `${n} routes` : `${n} nodes`
}

function makeGroup(map: AppMap, kind: MapKind, folder: string, members: MapItem[]): Shape {
  let cache = groupCache.get(map)
  if (!cache) {
    cache = new Map()
    groupCache.set(map, cache)
  }
  const key = `folder:${folder}`
  const cached = cache.get(key)
  if (cached) return cached
  const label = `${folder.split("/").pop()}/`
  const labW = mono(label)
  let size: Pick<Shape, "hw" | "hh" | "oy" | "w" | "r">
  if (kind === "workflow") {
    const mw = (members[0] as WorkflowItem).middleware.length
    const w = 10 + (mw ? mw * 9 + 6 : 0) + labW + 10 + mono(`${members.length} routes`, 10.5) + 14
    size = { w, hw: w / 2 + 3, hh: 18, oy: 0, r: 0 }
  } else {
    const r = 13 + Math.min(members.length, 6) * 2
    size = { r, w: 0, hw: Math.max(r + 4, labW / 2 + 4), hh: r + 10, oy: 8 }
  }
  const shape: Shape = {
    key,
    kind,
    folder,
    members,
    label,
    ...size,
    x: Number.NaN,
    y: Number.NaN,
    visible: true,
  }
  cache.set(key, shape)
  return shape
}

const itemShapes = new WeakMap<MapItem, Shape>()

export function buildDisplay(
  map: AppMap,
  opts: { group: boolean; visible: ReadonlySet<string>; measure: Measure },
): DisplayGraph {
  const rep = new Map<string, Shape>()
  for (const it of map.items) {
    let shape = itemShapes.get(it)
    if (!shape) {
      shape = {
        key: it.key,
        kind: it.kind,
        folder: it.folder,
        item: it,
        label: it.label,
        ...sizeItem(it, opts.measure),
        x: Number.NaN,
        y: Number.NaN,
        visible: true,
      }
      itemShapes.set(it, shape)
    }
    if (opts.group && (it.kind === "workflow" || it.kind === "node")) {
      const siblings = map.items.filter((o) => o.kind === it.kind && o.folder === it.folder)
      if (siblings.length > 1) shape = makeGroup(map, it.kind, it.folder, siblings)
    }
    rep.set(it.key, shape)
  }
  const shapes = [...new Set(rep.values())]
  for (const s of shapes) {
    s.visible = s.members ? s.members.some((m) => opts.visible.has(m.key)) : opts.visible.has(s.key)
    if (s.members && Number.isNaN(s.x)) {
      const placed = s.members
        .map((m) => itemShapes.get(m))
        .filter((m): m is Shape => !!m && !Number.isNaN(m.x))
      if (placed.length) {
        s.x = placed.reduce((a, m) => a + m.x, 0) / placed.length
        s.y = placed.reduce((a, m) => a + m.y, 0) / placed.length
      }
    }
  }

  const merged = new Map<string, ShapeEdge>()
  for (const e of map.edges) {
    const a = rep.get(e.source)?.key
    const b = rep.get(e.target)?.key
    if (!a || !b || a === b) continue
    const k = `${a}|${b}|${e.type}`
    const found = merged.get(k)
    if (found) found.weight++
    else merged.set(k, { source: a, target: b, type: e.type, weight: 1 })
  }
  const covers = new Map<string, ShapeEdge>()
  for (const it of map.items) {
    if (it.kind !== "middleware") continue
    for (const w of (it as MiddlewareItem).covers) {
      const b = rep.get(w)?.key
      if (b) covers.set(`${it.key}|${b}`, { source: it.key, target: b, type: "cover", weight: 1 })
    }
  }
  return {
    shapes,
    byKey: new Map(shapes.map((s) => [s.key, s])),
    rep,
    edges: [...merged.values()],
    covers: [...covers.values()],
  }
}
