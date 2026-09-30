import type { NodeInstance, WorkflowFile } from "@/lib/api"
import { deleteNode } from "./delete-node"

/**
 * What changed between two versions of a workflow, in the graph's own terms:
 * nodes added and removed, inputs rewired, values edited, nodes moved.
 */

export type NodeDiffState = "added" | "removed" | "changed" | "same"

export type ChangeKind =
  | "node-added"
  | "node-removed"
  | "uses-changed"
  | "label-changed"
  | "connected"
  | "disconnected"
  | "rewired"
  | "value-changed"
  | "after-changed"
  | "when-changed"

export interface WorkflowChange {
  kind: ChangeKind
  nodeId: string
  /** The input field; "" is the whole input (`in: "ref"`). */
  field?: string
  before?: unknown
  after?: unknown
  /** One line for the change list, e.g. `SaveUser.role changed "member" → "admin"`. */
  text: string
}

export interface WorkflowDiff {
  nodes: Record<string, NodeDiffState>
  changes: WorkflowChange[]
  /** Nodes in both versions whose position changed (layout only). */
  moved: string[]
}

/** `in:` as field → reference, with the whole-input form under "". */
export function inputRefs(node: NodeInstance | undefined): Record<string, string> {
  if (!node?.in) return {}
  if (typeof node.in === "string") return { "": node.in }
  return { ...node.in }
}

function show(v: unknown): string {
  return v === undefined ? "nothing" : JSON.stringify(v)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** "if Room.found" / "if not Room.found". */
function describeWhen(when: string | undefined): string {
  if (when === undefined) return "always"
  return when.startsWith("!") ? `if not ${when.slice(1)}` : `if ${when}`
}

function target(nodeId: string, field: string): string {
  return field === "" ? nodeId : `${nodeId}.${field}`
}

export function diffWorkflows(
  before: WorkflowFile | null,
  after: WorkflowFile | null,
): WorkflowDiff {
  const a = before?.nodes ?? {}
  const b = after?.nodes ?? {}
  const nodes: Record<string, NodeDiffState> = {}
  const changes: WorkflowChange[] = []
  const moved: string[] = []

  for (const [id, node] of Object.entries(b)) {
    if (a[id]) continue
    nodes[id] = "added"
    changes.push({
      kind: "node-added",
      nodeId: id,
      after: node,
      text: `Added node ${id} ${node.uses}`,
    })
    for (const [field, ref] of Object.entries(inputRefs(node))) {
      changes.push({
        kind: "connected",
        nodeId: id,
        field,
        after: ref,
        text: `Connected ${ref} → ${target(id, field)}`,
      })
    }
  }

  for (const [id, node] of Object.entries(a)) {
    if (b[id]) continue
    nodes[id] = "removed"
    const links = Object.keys(inputRefs(node)).length
    changes.push({
      kind: "node-removed",
      nodeId: id,
      before: node,
      text:
        links > 0
          ? `Removed node ${id} and ${links} ${links === 1 ? "connection" : "connections"}`
          : `Removed node ${id}`,
    })
  }

  for (const [id, now] of Object.entries(b)) {
    const was = a[id]
    if (!was) continue
    const own: WorkflowChange[] = []
    if (was.uses !== now.uses) {
      own.push({
        kind: "uses-changed",
        nodeId: id,
        before: was.uses,
        after: now.uses,
        text: `${id} now uses ${now.uses} (was ${was.uses})`,
      })
    }
    if (was.label !== now.label) {
      own.push({
        kind: "label-changed",
        nodeId: id,
        before: was.label,
        after: now.label,
        text: `${id} renamed to ${show(now.label)}`,
      })
    }
    const refsA = inputRefs(was)
    const refsB = inputRefs(now)
    for (const field of new Set([...Object.keys(refsA), ...Object.keys(refsB)])) {
      const r0 = refsA[field]
      const r1 = refsB[field]
      if (r0 === r1) continue
      const to = target(id, field)
      if (r0 === undefined) {
        own.push({
          kind: "connected",
          nodeId: id,
          field,
          after: r1,
          text: `Connected ${r1} → ${to}`,
        })
      } else if (r1 === undefined) {
        own.push({
          kind: "disconnected",
          nodeId: id,
          field,
          before: r0,
          text: `Disconnected ${r0} → ${to}`,
        })
      } else {
        own.push({
          kind: "rewired",
          nodeId: id,
          field,
          before: r0,
          after: r1,
          text: `${to} now reads ${r1} (was ${r0})`,
        })
      }
    }
    const valsA = was.values ?? {}
    const valsB = now.values ?? {}
    for (const field of new Set([...Object.keys(valsA), ...Object.keys(valsB)])) {
      const v0 = valsA[field]
      const v1 = valsB[field]
      if (same(v0, v1)) continue
      const text =
        v0 === undefined
          ? `${target(id, field)} set to ${show(v1)}`
          : v1 === undefined
            ? `${target(id, field)} cleared (was ${show(v0)})`
            : `${target(id, field)} changed ${show(v0)} → ${show(v1)}`
      own.push({ kind: "value-changed", nodeId: id, field, before: v0, after: v1, text })
    }
    if (!same(was.after ?? [], now.after ?? [])) {
      own.push({
        kind: "after-changed",
        nodeId: id,
        before: was.after,
        after: now.after,
        text: `${id} now runs after ${(now.after ?? []).join(", ") || "nothing extra"}`,
      })
    }
    if (was.when !== now.when) {
      own.push({
        kind: "when-changed",
        nodeId: id,
        before: was.when,
        after: now.when,
        text:
          now.when === undefined
            ? `${id} always runs (was only ${describeWhen(was.when)})`
            : `${id} now runs only ${describeWhen(now.when)}`,
      })
    }
    nodes[id] = own.length > 0 ? "changed" : "same"
    changes.push(...own)

    const p0 = before?.view?.[id]
    const p1 = after?.view?.[id]
    if (
      p0 &&
      p1 &&
      (Math.round(p0.x) !== Math.round(p1.x) || Math.round(p0.y) !== Math.round(p1.y))
    ) {
      moved.push(id)
    }
  }

  return { nodes, changes, moved }
}

/**
 * Undoes one change in `current`, taking the old state from `base`. Undoing an
 * added node removes it and the references to it; undoing a removed node puts
 * it back where it was.
 */
export function revertChange(
  current: WorkflowFile,
  base: WorkflowFile,
  change: WorkflowChange,
): WorkflowFile {
  const id = change.nodeId
  if (change.kind === "node-added") return deleteNode(current, id)
  if (change.kind === "node-removed") {
    const node = base.nodes[id]
    if (!node) return current
    const pos = base.view?.[id]
    return {
      ...current,
      nodes: { ...current.nodes, [id]: node },
      ...(pos ? { view: { ...(current.view ?? {}), [id]: pos } } : {}),
    }
  }
  const now = current.nodes[id]
  const was = base.nodes[id]
  if (!now) return current
  const next: NodeInstance = { ...now }
  switch (change.kind) {
    case "uses-changed":
      next.uses = was?.uses ?? now.uses
      break
    case "label-changed":
      if (was?.label === undefined) delete next.label
      else next.label = was.label
      break
    case "when-changed":
      if (was?.when === undefined) delete next.when
      else next.when = was.when
      break
    case "after-changed":
      if (was?.after === undefined) delete next.after
      else next.after = was.after
      break
    case "connected":
    case "disconnected":
    case "rewired": {
      const field = change.field ?? ""
      const old = inputRefs(was)[field]
      if (field === "") {
        if (old === undefined) delete next.in
        else next.in = old
        break
      }
      const refs = typeof now.in === "string" ? {} : { ...(now.in ?? {}) }
      if (old === undefined) delete refs[field]
      else refs[field] = old
      if (Object.keys(refs).length > 0) next.in = refs
      else delete next.in
      break
    }
    case "value-changed": {
      const field = change.field ?? ""
      const old = was?.values?.[field]
      const values = { ...(now.values ?? {}) }
      if (old === undefined) delete values[field]
      else values[field] = old
      if (Object.keys(values).length > 0) next.values = values
      else delete next.values
      break
    }
  }
  return { ...current, nodes: { ...current.nodes, [id]: next } }
}
