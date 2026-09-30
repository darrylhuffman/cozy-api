import {
  Background,
  BackgroundVariant,
  type Edge,
  Handle,
  type NodeTypes,
  Position,
  ReactFlow,
  type Node as RFNode,
  useReactFlow,
} from "@xyflow/react"
import { useEffect, useMemo } from "react"
import "@xyflow/react/dist/style.css"
import type { WorkflowFile } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useActiveTheme } from "@/store/theme"
import { formatValue } from "@/workflow/value-chip"
import { inputRefs, type NodeDiffState, type WorkflowDiff } from "@/workflow/workflow-diff"

const NODE_WIDTH = 270
const ROW = 24

type RowState = "added" | "removed" | "changed" | "same"

/** One input on a diff card: what fed it before and after. */
interface DiffRow {
  field: string
  before?: string | undefined
  after?: string | undefined
  state: RowState
}

interface DiffNodeData {
  id: string
  uses: string
  name: string
  state: NodeDiffState
  rows: DiffRow[]
  dimmed: boolean
  focused: boolean
}

export const STATE_COLOR: Record<NodeDiffState, string> = {
  added: "var(--success)",
  changed: "var(--warning)",
  removed: "var(--destructive)",
  same: "var(--muted-foreground)",
}

const BADGE: Record<NodeDiffState, string | null> = {
  added: "ADDED",
  changed: "CHANGED",
  removed: "REMOVED",
  same: null,
}

/** The pseudo-field a node's `when` condition is listed under. */
const WHEN_FIELD = "$when"

/** What an input shows: its source ("← a.b") or its literal. */
function slot(node: WorkflowFile["nodes"][string] | undefined, field: string): string | undefined {
  if (!node) return undefined
  if (field === WHEN_FIELD) {
    if (node.when === undefined) return undefined
    return node.when.startsWith("!") ? `if not ${node.when.slice(1)}` : `if ${node.when}`
  }
  const ref = inputRefs(node)[field]
  if (ref !== undefined) return `← ${ref}`
  const v = node.values?.[field]
  return v === undefined ? undefined : formatValue(v)
}

function rowsFor(
  was: WorkflowFile["nodes"][string] | undefined,
  now: WorkflowFile["nodes"][string] | undefined,
): DiffRow[] {
  const fields = new Set<string>()
  for (const n of [was, now]) {
    if (!n) continue
    if (n.when !== undefined) fields.add(WHEN_FIELD)
    for (const f of Object.keys(inputRefs(n))) fields.add(f)
    for (const f of Object.keys(n.values ?? {})) fields.add(f)
  }
  return [...fields].map((field) => {
    const before = slot(was, field)
    const after = slot(now, field)
    const state: RowState =
      before === after
        ? "same"
        : before === undefined
          ? "added"
          : after === undefined
            ? "removed"
            : "changed"
    return { field, before, after, state }
  })
}

function DiffNode({ data }: { data: Record<string, unknown> }) {
  const d = data as unknown as DiffNodeData
  const color = STATE_COLOR[d.state]
  const badge = BADGE[d.state]
  return (
    <div
      data-testid="diff-node"
      data-state={d.state}
      className={cn(
        "rounded-[10px] border bg-popover text-[12px] text-card-foreground shadow-[0_10px_24px_rgba(0,0,0,.18)] transition-opacity",
        d.state === "removed" && "border-dashed",
        d.state === "same" && "border-input",
        d.dimmed && "opacity-35",
        d.focused && "ring-2 ring-primary",
      )}
      style={{ width: NODE_WIDTH, ...(d.state !== "same" ? { borderColor: color } : {}) }}
    >
      <div
        className="relative flex h-8 items-center gap-2 rounded-t-[10px] border-b border-border px-3"
        style={{
          background:
            d.state === "same" ? undefined : `color-mix(in srgb, ${color} 12%, var(--popover))`,
        }}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-semibold text-[13px]",
            d.state === "removed" && "line-through decoration-destructive/70",
          )}
        >
          {d.name}
        </span>
        {badge && (
          <span
            className="shrink-0 rounded px-[5px] py-[2px] font-semibold text-[9.5px] tracking-[0.06em]"
            style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
          >
            {badge}
          </span>
        )}
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          isConnectable={false}
          style={{ width: 8, height: 8, background: "var(--muted-foreground)", border: 0 }}
        />
      </div>
      <div className="py-1">
        {d.rows.length === 0 && (
          <div className="px-3 py-1 text-[11px] text-muted-foreground">No inputs</div>
        )}
        {d.rows.map((r) => (
          <div
            key={r.field}
            data-testid={`diff-row-${d.id}-${r.field}`}
            data-state={r.state}
            className={cn(
              "relative flex items-center gap-2 px-3 text-[11.5px]",
              r.state !== "same" && d.state === "changed" && "bg-warning/8",
            )}
            style={{ minHeight: ROW }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={r.field === "" ? "$root" : r.field}
              isConnectable={false}
              style={{ width: 8, height: 8, background: "var(--muted-foreground)", border: 0 }}
            />
            <span className="w-[64px] shrink-0 truncate text-muted-foreground">
              {r.field === "" ? "input" : r.field === WHEN_FIELD ? "when" : r.field}
            </span>
            {r.state === "changed" ? (
              <span className="flex min-w-0 flex-1 flex-col items-end py-0.5 font-mono text-[10.5px] leading-[1.45]">
                <span className="max-w-full truncate text-destructive line-through">
                  {r.before}
                </span>
                <span className="max-w-full truncate text-success">{r.after}</span>
              </span>
            ) : (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-right font-mono text-[10.5px]",
                  r.state === "added" && "text-success",
                  r.state === "removed" && "text-destructive line-through",
                )}
              >
                {r.state === "removed" ? r.before : r.after}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="truncate border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
        {d.uses}
      </div>
    </div>
  )
}

const nodeTypes: NodeTypes = { diff: DiffNode as NodeTypes[string] }

export interface DiffFilters {
  added: boolean
  changed: boolean
  removed: boolean
}

/**
 * Both versions of a workflow as one read-only graph: removed nodes stay where
 * they were, dashed and struck through; added and changed nodes are marked;
 * each changed input shows its old and new source or value.
 */
export function WorkflowDiffCanvas({
  before,
  after,
  diff,
  filters,
  focusId,
}: {
  before: WorkflowFile | null
  after: WorkflowFile | null
  diff: WorkflowDiff
  filters: DiffFilters
  focusId: string | null
}) {
  const theme = useActiveTheme()
  const { fitView } = useReactFlow()

  const nodes = useMemo<RFNode[]>(() => {
    const ids = [...Object.keys(after?.nodes ?? {})]
    for (const id of Object.keys(before?.nodes ?? {})) if (!after?.nodes[id]) ids.push(id)
    return ids.map((id, i) => {
      const was = before?.nodes[id]
      const now = after?.nodes[id]
      const node = (now ?? was)!
      const state = diff.nodes[id] ?? "same"
      const pos = (now ? after?.view?.[id] : undefined) ??
        before?.view?.[id] ?? {
          x: 40 + (i % 4) * 300,
          y: 40 + Math.floor(i / 4) * 220,
        }
      const hidden =
        (state === "added" && !filters.added) ||
        (state === "changed" && !filters.changed) ||
        (state === "removed" && !filters.removed)
      const data: DiffNodeData = {
        id,
        uses: node.uses,
        // Ids, like the change list, so the two read together.
        name: node.label ?? id,
        state,
        rows: rowsFor(was, now),
        dimmed: hidden || (focusId !== null && focusId !== id && state === "same"),
        focused: focusId === id,
      }
      return { id, type: "diff", position: pos, data: data as unknown as Record<string, unknown> }
    })
  }, [before, after, diff, filters, focusId])

  const edges = useMemo<Edge[]>(() => {
    const byKey = new Map<
      string,
      { source: string; target: string; field: string; state: RowState }
    >()
    const collect = (wf: WorkflowFile | null, side: "before" | "after") => {
      for (const [id, node] of Object.entries(wf?.nodes ?? {})) {
        const refs = inputRefs(node)
        if (node.when !== undefined) refs[WHEN_FIELD] = node.when.replace(/^!/, "")
        for (const [field, ref] of Object.entries(refs)) {
          const source = ref.split(".")[0] ?? ""
          const key = `${source}|${id}|${field}|${ref}`
          const seen = byKey.get(key)
          if (seen) seen.state = "same"
          else
            byKey.set(key, {
              source,
              target: id,
              field,
              state: side === "before" ? "removed" : "added",
            })
        }
      }
    }
    collect(before, "before")
    collect(after, "after")
    const present = new Set(nodes.map((n) => n.id))
    return [...byKey.entries()]
      .filter(([, e]) => present.has(e.source) && present.has(e.target))
      .map(([key, e]) => ({
        id: key,
        source: e.source,
        sourceHandle: "out",
        target: e.target,
        targetHandle: e.field === "" ? "$root" : e.field,
        style:
          e.state === "added"
            ? { stroke: "var(--success)", strokeWidth: 2 }
            : e.state === "removed"
              ? { stroke: "var(--destructive)", strokeWidth: 1.5, strokeDasharray: "5 4" }
              : { stroke: "var(--muted-foreground)", strokeOpacity: 0.55 },
      }))
  }, [before, after, nodes])

  useEffect(() => {
    if (!focusId) return
    void fitView({ nodes: [{ id: focusId }], padding: 0.8, maxZoom: 1.1, duration: 250 })
  }, [focusId, fitView])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      colorMode={theme.mode}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--canvas-dot)" />
    </ReactFlow>
  )
}
