import type { NodeInstance, WorkflowFile } from "@/lib/api"
import { uniqueId } from "./add-node"

/** Rewrites a reference string whose first segment is `from` to start with `to`. */
function renameRef(ref: string, from: string, to: string): string {
  if (ref === from) return to
  if (ref.startsWith(`${from}.`)) return `${to}${ref.slice(from.length)}`
  return ref
}

/**
 * Renames a node instance and rewrites every reference to it (`in:` bindings,
 * `after:` lists, `when:` conditions, the `view` entry). Key order in `nodes` is preserved so the
 * saved file diff stays small.
 */
export function renameNode(wf: WorkflowFile, from: string, to: string): WorkflowFile {
  if (from === to || !wf.nodes[from] || wf.nodes[to]) return wf
  const nodes: Record<string, NodeInstance> = {}
  for (const [id, node] of Object.entries(wf.nodes)) {
    let next: NodeInstance = node
    if (typeof node.in === "string") {
      next = { ...next, in: renameRef(node.in, from, to) }
    } else if (node.in) {
      next = {
        ...next,
        in: Object.fromEntries(
          Object.entries(node.in).map(([k, v]) => [k, renameRef(v, from, to)]),
        ),
      }
    }
    if (node.after) next = { ...next, after: node.after.map((a) => (a === from ? to : a)) }
    if (node.when) {
      const negate = node.when.startsWith("!")
      const ref = renameRef(negate ? node.when.slice(1) : node.when, from, to)
      next = { ...next, when: negate ? `!${ref}` : ref }
    }
    nodes[id === from ? to : id] = next
  }
  let view = wf.view
  if (view?.[from]) {
    view = Object.fromEntries(Object.entries(view).map(([id, pos]) => [id === from ? to : id, pos]))
  }
  return { ...wf, nodes, ...(view ? { view } : {}) }
}

/**
 * Copies a node (its uses, bindings, literal values and label) under a fresh
 * id, offset from the original. Returns the new workflow and the new id.
 */
export function duplicateNode(
  wf: WorkflowFile,
  id: string,
  fallbackPosition: { x: number; y: number } = { x: 0, y: 0 },
): { workflow: WorkflowFile; id: string } | null {
  const node = wf.nodes[id]
  if (!node) return null
  const base = id.replace(/\d+$/, "") || "node"
  const newId = uniqueId(base, new Set(Object.keys(wf.nodes)))
  const pos = wf.view?.[id] ?? fallbackPosition
  const copy: NodeInstance = structuredClone(node)
  return {
    id: newId,
    workflow: {
      ...wf,
      nodes: { ...wf.nodes, [newId]: copy },
      view: { ...(wf.view ?? {}), [newId]: { x: pos.x + 40, y: pos.y + 40 } },
    },
  }
}

export interface LayoutOptions {
  /** Horizontal distance between columns (left edge to left edge). */
  columnGap?: number
  /** Vertical gap between stacked nodes. */
  rowGap?: number
  /** Measured node heights; unmeasured nodes use `defaultHeight`. */
  heights?: Record<string, number>
  defaultHeight?: number
}

/**
 * Left-to-right layered layout: each node sits one column right of its
 * deepest dependency (data references and `after:`), so data flows
 * rightwards. Within a column, nodes keep their current top-to-bottom order.
 * Cycles are tolerated (the back edge is ignored).
 */
export function tidyLayout(wf: WorkflowFile, opts: LayoutOptions = {}): WorkflowFile {
  const columnGap = opts.columnGap ?? 320
  const rowGap = opts.rowGap ?? 40
  const defaultHeight = opts.defaultHeight ?? 120
  const ids = Object.keys(wf.nodes)
  const deps = new Map<string, string[]>()
  for (const id of ids) {
    const node = wf.nodes[id]!
    const refs: string[] = []
    const add = (ref: string) => {
      const src = ref.split(".")[0]
      if (src && src !== id && wf.nodes[src]) refs.push(src)
    }
    if (typeof node.in === "string") add(node.in)
    else if (node.in) for (const v of Object.values(node.in)) add(v)
    for (const a of node.after ?? []) add(a)
    deps.set(id, refs)
  }

  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    let d = 0
    for (const dep of deps.get(id) ?? []) d = Math.max(d, depthOf(dep) + 1)
    visiting.delete(id)
    depth.set(id, d)
    return d
  }
  for (const id of ids) depthOf(id)

  const columns = new Map<number, string[]>()
  for (const id of ids) {
    const d = depth.get(id) ?? 0
    const col = columns.get(d) ?? []
    col.push(id)
    columns.set(d, col)
  }

  const view: Record<string, { x: number; y: number }> = {}
  for (const [d, col] of columns) {
    col.sort((a, b) => (wf.view?.[a]?.y ?? 0) - (wf.view?.[b]?.y ?? 0))
    let y = 40
    for (const id of col) {
      view[id] = { x: 40 + d * columnGap, y }
      y += (opts.heights?.[id] ?? defaultHeight) + rowGap
    }
  }
  return { ...wf, view }
}
