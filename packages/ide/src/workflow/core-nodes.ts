import type { JsonSchema, NodeInstance, WorkflowFile } from "@/lib/api"

/**
 * Built-in node ids the IDE treats specially. The runtime's core registry is
 * the source of truth; these mirror it.
 */
export const HTTP_RESPONSE = "@core/http-response"
export const SWITCH_USES = "@core/switch"

/** Old core ids that still resolve, by their current id. */
const RENAMED: Record<string, string> = { "@core/response": HTTP_RESPONSE }

/** True for the node that answers the request, under its current or old name. */
export function isHttpResponse(uses: string): boolean {
  return (RENAMED[uses] ?? uses) === HTTP_RESPONSE
}

/** Logic nodes whose `true`/`false` outputs are branches. */
const BOOLEAN_BRANCHES = new Set(["@core/if", "@core/and", "@core/or", "@core/not"])

/** The cases a switch compares against, from its `values.cases`. */
export function switchCases(instance: NodeInstance | undefined): unknown[] {
  const cases = instance?.values?.cases
  return Array.isArray(cases) ? cases : []
}

/**
 * True when `port` on a node of type `uses` is a branch: an output meant for
 * other nodes' `when`, so wiring it anywhere sets a condition instead of an input.
 */
export function isBranchPort(uses: string, port: string): boolean {
  if (uses === SWITCH_USES) return port === "default" || /^case\d+$/.test(port)
  return BOOLEAN_BRANCHES.has(uses) && (port === "true" || port === "false")
}

/** A case value as a short label: strings bare, everything else as JSON. */
export function caseLabel(value: unknown): string {
  if (typeof value === "string") return value === "" ? '""' : value
  return JSON.stringify(value) ?? "undefined"
}

/** Sets a switch's cases. */
export function setSwitchCases(wf: WorkflowFile, nodeId: string, cases: unknown[]): WorkflowFile {
  const node = wf.nodes[nodeId]
  if (!node) return wf
  const next: NodeInstance = { ...node, values: { ...node.values, cases } }
  return { ...wf, nodes: { ...wf.nodes, [nodeId]: next } }
}

/**
 * Removes case `index` (0-based) from a switch. Later cases move up one, so
 * references to them are renumbered; whatever read the removed case loses
 * that condition or input.
 */
export function removeSwitchCase(wf: WorkflowFile, nodeId: string, index: number): WorkflowFile {
  const cases = switchCases(wf.nodes[nodeId])
  if (index < 0 || index >= cases.length) return wf
  const out = setSwitchCases(
    wf,
    nodeId,
    cases.filter((_, i) => i !== index),
  )
  const removed = index + 1
  // "Kind.case3.x" → "Kind.case2.x"; null when it read the removed case.
  const renumber = (ref: string): string | null => {
    const negate = ref.startsWith("!")
    const body = negate ? ref.slice(1) : ref
    const [id, first, ...rest] = body.split(".")
    const m = id === nodeId && first ? /^case(\d+)$/.exec(first) : null
    if (!m) return ref
    const n = Number(m[1])
    if (n === removed) return null
    if (n < removed) return ref
    return `${negate ? "!" : ""}${[id, `case${n - 1}`, ...rest].join(".")}`
  }
  const nodes: Record<string, NodeInstance> = {}
  for (const [id, node] of Object.entries(out.nodes)) {
    let next = node
    if (node.when !== undefined) {
      const when = renumber(node.when)
      if (when !== node.when) {
        next = { ...next }
        if (when === null) delete next.when
        else next.when = when
      }
    }
    if (typeof node.in === "string") {
      const ref = renumber(node.in)
      if (ref !== node.in) {
        next = { ...next }
        if (ref === null) delete next.in
        else next.in = ref
      }
    } else if (node.in) {
      const entries = Object.entries(node.in).flatMap(([k, v]) => {
        const ref = renumber(v)
        return ref === null ? [] : [[k, ref] as const]
      })
      const changed =
        entries.length !== Object.keys(node.in).length ||
        entries.some(([k, v]) => (node.in as Record<string, string>)[k] !== v)
      if (changed) next = { ...next, in: Object.fromEntries(entries) }
    }
    nodes[id] = next
  }
  return { ...out, nodes }
}

/**
 * The label on a condition edge that leaves a branch output: the case it
 * matched ("= cat"), "default", or "true"/"false". Null for other outputs.
 */
export function branchLabel(wf: WorkflowFile, nodeId: string, path: string[]): string | null {
  const source = wf.nodes[nodeId]
  const port = path[0]
  if (!source || !port || path.length !== 1 || !isBranchPort(source.uses, port)) return null
  const m = /^case(\d+)$/.exec(port)
  if (m) {
    const cases = switchCases(source)
    const n = Number(m[1])
    return n <= cases.length ? `= ${caseLabel(cases[n - 1])}` : port
  }
  return port
}

/** A switch's outputs schema with its `caseN` outputs added. */
export function switchOutputSchema(instance: NodeInstance, base: JsonSchema): JsonSchema {
  const cases = Object.fromEntries(
    switchCases(instance).map((_, i) => [`case${i + 1}`, { type: "boolean" }] as const),
  )
  return { ...base, properties: { ...cases, ...base.properties } }
}
