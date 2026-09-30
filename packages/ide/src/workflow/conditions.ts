import type { JsonSchema, NodeInstance, NodeSchemas, WorkflowFile } from "@/lib/api"
import { unwrapSchema } from "./variables"

/**
 * Conditions are a node's `when`: "Room.found" runs the node only when that
 * output is truthy, "!Room.found" only when it's falsy. The canvas draws each
 * one as a dashed edge into the node's condition handle.
 */

/** Handle id of the target a condition edge lands on. */
export const WHEN_HANDLE_ID = "$when"

export interface Condition {
  /** The reference without the "!", e.g. "Room.found". */
  ref: string
  /** The node the condition reads. */
  nodeId: string
  /** The output path inside that node, e.g. ["found"]; empty for the whole output. */
  path: string[]
  /** True for "!ref": the node runs when the value is falsy. */
  negate: boolean
}

const SEGMENT = /^[a-zA-Z_$][\w$]*$/

/** Parses a `when` string; null when it isn't a reference. */
export function parseCondition(raw: string | undefined): Condition | null {
  if (typeof raw !== "string") return null
  const negate = raw.startsWith("!")
  const ref = negate ? raw.slice(1) : raw
  const [nodeId, ...path] = ref.split(".")
  if (!nodeId || !SEGMENT.test(nodeId) || path.some((s) => !SEGMENT.test(s))) return null
  return { ref, nodeId, path, negate }
}

/** Short edge label: "if found", "if not found". */
export function conditionLabel(c: Condition): string {
  const subject = c.path.length > 0 ? c.path[c.path.length - 1] : c.nodeId
  return c.negate ? `if not ${subject}` : `if ${subject}`
}

/** Sets (or, with `ref` null, clears) a node's condition. */
export function setCondition(
  wf: WorkflowFile,
  nodeId: string,
  ref: string | null,
  negate = false,
): WorkflowFile {
  const node = wf.nodes[nodeId]
  if (!node) return wf
  const next: NodeInstance = { ...node }
  if (ref === null) delete next.when
  else next.when = negate ? `!${ref}` : ref
  if (next.when === node.when) return wf
  return { ...wf, nodes: { ...wf.nodes, [nodeId]: next } }
}

/** Flips "Room.found" ⇄ "!Room.found". */
export function flipCondition(wf: WorkflowFile, nodeId: string): WorkflowFile {
  const c = parseCondition(wf.nodes[nodeId]?.when)
  if (!c) return wf
  return setCondition(wf, nodeId, c.ref, !c.negate)
}

/**
 * Nodes that run after `nodeId` (they read it, wait on it, or branch on it).
 * A condition can't read any of them without making a cycle.
 */
export function downstreamOf(wf: WorkflowFile, nodeId: string): Set<string> {
  const readers = new Map<string, string[]>()
  for (const [id, node] of Object.entries(wf.nodes)) {
    for (const dep of dependencies(node)) {
      const list = readers.get(dep) ?? []
      list.push(id)
      readers.set(dep, list)
    }
  }
  const out = new Set<string>()
  const queue = [nodeId]
  while (queue.length > 0) {
    for (const r of readers.get(queue.pop()!) ?? []) {
      if (out.has(r)) continue
      out.add(r)
      queue.push(r)
    }
  }
  return out
}

function dependencies(node: NodeInstance): string[] {
  const refs: string[] = []
  if (typeof node.in === "string") refs.push(node.in)
  else if (node.in) refs.push(...Object.values(node.in))
  const c = parseCondition(node.when)
  if (c) refs.push(c.ref)
  const deps = refs.map((r) => r.split(".")[0] ?? "")
  return [...deps, ...(node.after ?? [])]
}

export interface ConditionOption {
  /** The reference to store, e.g. "FindRoom.found". */
  ref: string
  /** The output's JSON type, when its schema says. */
  type: string | undefined
}

/**
 * Outputs `nodeId` could branch on: every other node's outputs (two levels
 * deep), booleans first, skipping nodes downstream of it.
 */
export function conditionOptions(
  wf: WorkflowFile,
  schemas: Record<string, NodeSchemas>,
  nodeId: string,
): ConditionOption[] {
  const blocked = downstreamOf(wf, nodeId)
  const out: ConditionOption[] = []
  for (const [id, node] of Object.entries(wf.nodes)) {
    if (id === nodeId || blocked.has(id)) continue
    const walk = (schema: JsonSchema | undefined, prefix: string, depth: number) => {
      const s = unwrapSchema(schema)
      for (const [key, child] of Object.entries(s?.properties ?? {})) {
        const c = unwrapSchema(child)
        const ref = `${prefix}.${key}`
        out.push({ ref, type: c?.type })
        if (depth < 1 && c?.type === "object") walk(c, ref, depth + 1)
      }
    }
    walk(schemas[node.uses]?.outputs, id, 0)
  }
  const rank = (o: ConditionOption) => (o.type === "boolean" ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b))
}
