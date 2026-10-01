import type { NodeInstance, NodeSchemas, WorkflowFile } from "@/lib/api"
import { uniqueId } from "./add-node"
import { isHttpResponse } from "./core-nodes"
import { TRIGGERS } from "./diagnose"
import {
  type FieldType,
  fieldTypeName,
  inputFields,
  invalidPortName,
  SUBWORKFLOW_INPUT,
  SUBWORKFLOW_OUTPUT,
  subworkflowUses,
} from "./subworkflow"
import { schemaAtPath } from "./variables"

/**
 * Moving a group of nodes into a new sub-workflow (extract), and putting a
 * sub-workflow node's nodes back into its workflow (inline).
 *
 * Extracting works out the group's boundary: every value the group reads from
 * outside becomes an input, every value read from it outside becomes an
 * output, and a run condition all of its first nodes share moves onto the new
 * node. The new node is wired so the workflow runs the same as before.
 */

interface Ref {
  nodeId: string
  path: string[]
  negate: boolean
}

function parseRef(raw: string | undefined): Ref | null {
  if (typeof raw !== "string") return null
  const negate = raw.startsWith("!")
  const [nodeId, ...path] = (negate ? raw.slice(1) : raw).split(".")
  if (!nodeId || !/^[A-Za-z_$][\w$]*$/.test(nodeId)) return null
  return { nodeId, path, negate }
}

function refString(nodeId: string, path: string[], negate = false): string {
  return `${negate ? "!" : ""}${[nodeId, ...path].join(".")}`
}

/** The ids a node reads values from: its `in` and its `when`. */
function dataDeps(node: NodeInstance): string[] {
  const refs = typeof node.in === "string" ? [node.in] : Object.values(node.in ?? {})
  if (node.when) refs.push(node.when)
  return refs.map((r) => parseRef(r)?.nodeId).filter((id): id is string => !!id)
}

function allDeps(node: NodeInstance): string[] {
  return [...dataDeps(node), ...(node.after ?? [])]
}

/** Calls `fix` on every reference a node holds and returns the node rewritten. */
function mapRefs(
  node: NodeInstance,
  fix: (ref: Ref, raw: string, field: string | null, kind: "in" | "when") => string | null,
): NodeInstance {
  const next: NodeInstance = { ...node }
  if (typeof node.in === "string") {
    const ref = parseRef(node.in)
    const v = ref ? fix(ref, node.in, null, "in") : node.in
    if (v === null) delete next.in
    else next.in = v
  } else if (node.in) {
    const entries: Array<[string, string]> = []
    for (const [field, raw] of Object.entries(node.in)) {
      const ref = parseRef(raw)
      const v = ref ? fix(ref, raw, field, "in") : raw
      if (v !== null) entries.push([field, v])
    }
    next.in = Object.fromEntries(entries)
    if (entries.length === 0) delete next.in
  }
  if (node.when) {
    const ref = parseRef(node.when)
    const v = ref ? fix(ref, node.when, null, "when") : node.when
    if (v === null) delete next.when
    else next.when = v
  }
  return next
}

function mapRefsList(node: NodeInstance): Array<{ ref: Ref; kind: "in" | "when" }> {
  const out: Array<{ ref: Ref; kind: "in" | "when" }> = []
  mapRefs(node, (ref, raw, _field, kind) => {
    out.push({ ref, kind })
    return raw
  })
  return out
}

export interface ExtractInput {
  /** The value it carries in, as the caller reads it: "Request.body.quantity". */
  source: string
  /** Its name on the sub-workflow's Input. */
  name: string
  type: FieldType
}

export interface ExtractOutput {
  /** What it hands out, inside the sub-workflow: "FindEvent.event" (or "FindEvent"). */
  source: string
  name: string
}

export interface ExtractionPlan {
  /** The nodes to move, in file order. */
  nodeIds: string[]
  /** Why the nodes can't be extracted; empty when they can. */
  errors: string[]
  /** Things the user should know before extracting. */
  notes: string[]
  inputs: ExtractInput[]
  outputs: ExtractOutput[]
  /** A run condition every first node shares, which moves onto the new node. */
  when: string | null
  /** Nodes outside the group that the group waits for (`after`). */
  after: string[]
  /** Statuses the group's Response nodes answer with. */
  responds: number[]
  /** Suggested folder under nodes/, e.g. "orders". */
  folder: string
  /** Suggested name, e.g. "Find event". */
  name: string
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

/** "FindEvent" → "Find event", "saveUser" → "Save user". */
export function humanize(id: string): string {
  const words = id
    .replace(/[-_]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "Reserve seats" → "reserve-seats". */
export function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "sub-workflow"
  )
}

/** "Reserve seats" → "ReserveSeats" (or "reserveSeats" with `camel`). */
function nodeIdFor(name: string, camel: boolean): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const pascal = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("") || "Subworkflow"
  const id = camel ? lowerFirst(pascal) : pascal
  return /^[0-9]/.test(id) ? `n${id}` : id
}

/** A usable port name from a reference segment or field name. */
function portBase(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback
  const camel = raw.replace(/[-\s]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase())
  return invalidPortName(camel) ? fallback : camel
}

/** The Input type for a value read from `ref`, from the source's schema when it has one. */
function typeOf(wf: WorkflowFile, schemas: Record<string, NodeSchemas>, ref: Ref): FieldType {
  const node = wf.nodes[ref.nodeId]
  if (!node) return "json"
  if (node.uses === SUBWORKFLOW_INPUT) {
    const field = inputFields(node)[ref.path[0] ?? ""]
    if (ref.path.length === 1) return fieldTypeName(field) ?? "json"
    return "json"
  }
  const at = schemaAtPath(schemas[node.uses]?.outputs, ref.path.join("."))
  const t = at?.type
  if (t === "string" || t === "boolean") return t
  if (t === "number" || t === "integer") return "number"
  if (!at && node.uses === "@core/http-request" && ref.path.length >= 2) {
    // Path params, query strings and headers arrive as text.
    if (["params", "query", "headers"].includes(ref.path[0] ?? "")) return "string"
  }
  return "json"
}

/**
 * Works out what extracting `selected` from `wf` would do. `workflowPath` is
 * the file being edited; it seeds the suggested folder.
 */
export function analyzeExtraction(
  wf: WorkflowFile,
  selected: string[],
  schemas: Record<string, NodeSchemas>,
  workflowPath: string,
  exists?: (path: string) => boolean,
): ExtractionPlan {
  const sel = new Set(selected.filter((id) => wf.nodes[id]))
  const nodeIds = Object.keys(wf.nodes).filter((id) => sel.has(id))
  const errors: string[] = []
  const notes: string[] = []

  if (nodeIds.length === 0) errors.push("Select the nodes to move into a sub-workflow.")
  for (const id of nodeIds) {
    const uses = wf.nodes[id]?.uses ?? ""
    if (TRIGGERS.has(uses)) {
      errors.push(`${id} is the workflow's trigger. Triggers stay in the workflow; leave it out.`)
    }
    if (uses === SUBWORKFLOW_INPUT || uses === SUBWORKFLOW_OUTPUT) {
      errors.push(`${id} is one of this sub-workflow's ports and can't move into another one.`)
    }
  }

  // A node outside the group that reads from it and feeds back into it would
  // have to run in the middle of the new node.
  const fwd = new Map<string, string[]>()
  const bwd = new Map<string, string[]>()
  for (const [id, node] of Object.entries(wf.nodes)) {
    for (const dep of allDeps(node)) {
      if (!wf.nodes[dep]) continue
      fwd.set(dep, [...(fwd.get(dep) ?? []), id])
      bwd.set(id, [...(bwd.get(id) ?? []), dep])
    }
  }
  const reach = (adj: Map<string, string[]>) => {
    const seen = new Set<string>()
    const stack = [...sel]
    while (stack.length > 0) {
      for (const next of adj.get(stack.pop() as string) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
    return seen
  }
  const down = reach(fwd)
  const up = reach(bwd)
  const gaps = Object.keys(wf.nodes).filter((id) => !sel.has(id) && down.has(id) && up.has(id))
  if (gaps.length > 0) {
    errors.push(
      `${gaps.join(", ")} ${gaps.length > 1 ? "read" : "reads"} from the selection and ${gaps.length > 1 ? "feed" : "feeds"} back into it. Add ${gaps.length > 1 ? "them" : "it"} to the selection, or leave out the nodes after ${gaps.length > 1 ? "them" : "it"}.`,
    )
  }

  // First nodes: they read no value from inside the group. When they all run
  // on the same outside condition, the new node takes it over.
  const roots = nodeIds.filter((id) =>
    dataDeps(wf.nodes[id] as NodeInstance).every((d) => !sel.has(d)),
  )
  const rootWhens = roots.map((id) => wf.nodes[id]?.when)
  const first = rootWhens[0]
  const firstRef = parseRef(first)
  // A first node that would read nothing and waits on a node inside can't
  // pick the condition up from the new node, so it keeps its own.
  const liftable = (id: string) => {
    const node = wf.nodes[id] as NodeInstance
    const reads = mapRefsList(node).filter((r) => r.kind === "in").length > 0
    return reads || !(node.after ?? []).some((a) => sel.has(a))
  }
  const when =
    roots.length > 0 &&
    first &&
    firstRef &&
    !sel.has(firstRef.nodeId) &&
    rootWhens.every((w) => w === first) &&
    roots.every(liftable)
      ? first
      : null
  const liftedFrom = new Set(when ? roots : [])

  // Inputs: one per outside value the group reads, named after the field
  // that reads it. Conditions on outside values become boolean inputs.
  const inputs: ExtractInput[] = []
  const inputBySource = new Map<string, ExtractInput>()
  const inputNames = new Set<string>()
  const addInput = (ref: Ref, base: string, type: FieldType) => {
    const source = refString(ref.nodeId, ref.path)
    let input = inputBySource.get(source)
    if (!input) {
      input = { source, name: uniqueId(base, inputNames), type }
      inputNames.add(input.name)
      inputBySource.set(source, input)
      inputs.push(input)
    }
  }
  for (const id of nodeIds) {
    const node = wf.nodes[id] as NodeInstance
    mapRefs(node, (ref, raw, field, kind) => {
      if (sel.has(ref.nodeId) || !wf.nodes[ref.nodeId]) return raw
      const isWhen = kind === "when"
      if (isWhen && liftedFrom.has(id)) return raw
      const last = ref.path[ref.path.length - 1]
      const base = portBase(field ?? last, lowerFirst(ref.nodeId))
      addInput(ref, base, isWhen ? "boolean" : typeOf(wf, schemas, ref))
      return raw
    })
  }

  // A value under one that's already an input reads through it.
  const folded = inputs.filter((i) => !inputs.some((o) => i.source.startsWith(`${o.source}.`)))
  inputs.splice(0, inputs.length, ...folded)

  // Outputs: one per port of a group node read from outside.
  const outputs: ExtractOutput[] = []
  const outputBySource = new Map<string, ExtractOutput>()
  const outputNames = new Set<string>()
  for (const [id, node] of Object.entries(wf.nodes)) {
    if (sel.has(id)) continue
    mapRefs(node, (ref, raw) => {
      if (!sel.has(ref.nodeId)) return raw
      const port = ref.path[0]
      const source = refString(ref.nodeId, port === undefined ? [] : [port])
      if (outputBySource.has(source)) return raw
      let base = portBase(port, lowerFirst(ref.nodeId))
      if (outputNames.has(base) && port !== undefined) {
        base = lowerFirst(ref.nodeId) + base.charAt(0).toUpperCase() + base.slice(1)
      }
      const output = { source, name: uniqueId(base, outputNames) }
      outputNames.add(output.name)
      outputBySource.set(source, output)
      outputs.push(output)
      return raw
    })
  }

  const after = [
    ...new Set(
      nodeIds.flatMap((id) =>
        (wf.nodes[id]?.after ?? []).filter((a) => !sel.has(a) && wf.nodes[a]),
      ),
    ),
  ]

  const responds = [
    ...new Set(
      nodeIds
        .map((id) => wf.nodes[id] as NodeInstance)
        .filter((n) => isHttpResponse(n.uses))
        .map((n) => (typeof n.values?.status === "number" ? n.values.status : 200)),
    ),
  ].sort((a, b) => a - b)

  // A sub-workflow node runs all at once: when any value it reads is skipped,
  // nothing inside it runs, and its outputs are all there or all missing.
  const conditional = conditionalNodes(wf)
  const skippable = inputs
    .map((i) => parseRef(i.source)?.nodeId as string)
    .filter((id, i, all) => conditional.has(id) && all.indexOf(id) === i)
  if (inputs.length > 1 && skippable.length > 0) {
    notes.push(
      `${skippable.join(", ")} might not run. If it doesn't, nothing in the sub-workflow runs, not just the nodes that read it.`,
    )
  }
  const innerConditional = outputs
    .map((o) => parseRef(o.source)?.nodeId as string)
    .filter((id, i, all) => all.indexOf(id) === i)
    .filter((id) => {
      const node = wf.nodes[id] as NodeInstance
      return (
        (node.when && !liftedFrom.has(id)) ||
        dataDeps(node).some((d) => sel.has(d) && conditional.has(d))
      )
    })
  if (outputs.length > 1 && innerConditional.length > 0) {
    notes.push(
      `${innerConditional.join(", ")} might not run. When an output is missing, every node reading any of the sub-workflow's outputs is skipped.`,
    )
  }
  if (responds.length > 0) {
    notes.push("Its Response nodes still answer the request from inside the sub-workflow.")
  }

  // Folder: where the group's own nodes live, else next to the workflow.
  const folders = new Set(
    nodeIds
      .map((id) => wf.nodes[id]?.uses ?? "")
      .filter((u) => u.startsWith("./nodes/"))
      .map((u) => u.split("/").slice(2, -1).join("/")),
  )
  const wfFolder = workflowPath.split("/").slice(1, -1).join("/")
  const folder = folders.size === 1 ? ([...folders][0] as string) || wfFolder : wfFolder

  const named =
    nodeIds.find((id) => !(wf.nodes[id]?.uses ?? "").startsWith("@core/") && roots.includes(id)) ??
    nodeIds.find((id) => !(wf.nodes[id]?.uses ?? "").startsWith("@core/")) ??
    nodeIds[0]
  let name = named ? (wf.nodes[named]?.label ?? humanize(named)) : "Sub-workflow"
  // "Find pet" next to find-pet.ts would come out find-pet-2.workflow.
  if (exists?.(subworkflowPathFor(name, folder || "shared"))) name = `${name} flow`

  return {
    nodeIds,
    errors,
    notes,
    inputs,
    outputs,
    when,
    after,
    responds,
    folder: folder || "shared",
    name,
  }
}

/** Nodes that might not run: they have a `when`, or read one that might not. */
function conditionalNodes(wf: WorkflowFile): Set<string> {
  const out = new Set<string>()
  const visiting = new Set<string>()
  const check = (id: string): boolean => {
    if (out.has(id)) return true
    if (visiting.has(id)) return false
    visiting.add(id)
    const node = wf.nodes[id]
    const yes = !!node && (!!node.when || dataDeps(node).some((d) => wf.nodes[d] && check(d)))
    if (yes) out.add(id)
    return yes
  }
  for (const id of Object.keys(wf.nodes)) check(id)
  return out
}

export interface ExtractOptions {
  /** Shown on the node, e.g. "Reserve seats". */
  name: string
  /** Folder under nodes/, e.g. "orders". */
  folder: string
  /** Port names, in the plan's order; the plan's names when left out. */
  inputNames?: string[]
  outputNames?: string[]
  /** True when a file already exists at a workspace path. */
  exists?: (path: string) => boolean
}

export interface ExtractResult {
  /** The edited workflow, with the group replaced by one node. */
  caller: WorkflowFile
  /** The new sub-workflow file. */
  sub: WorkflowFile
  /** The new node's id in the caller. */
  nodeId: string
  /** The new file, e.g. "nodes/orders/reserve-seats.workflow". */
  path: string
}

const CARD_GAP = 360

/** Where a new sub-workflow named `name` goes: the first free file in `folder` under nodes/. */
export function subworkflowPathFor(
  name: string,
  folder: string,
  exists?: (path: string) => boolean,
): string {
  const dir =
    folder
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .replace(/^nodes(\/|$)/, "") || "shared"
  const slug = slugify(name)
  let path = `nodes/${dir}/${slug}.workflow`
  for (let k = 2; exists?.(path); k++) path = `nodes/${dir}/${slug}-${k}.workflow`
  return path
}

/** Moves the plan's nodes into a new sub-workflow and puts one node in their place. */
export function extractSubworkflow(
  wf: WorkflowFile,
  plan: ExtractionPlan,
  opts: ExtractOptions,
): ExtractResult {
  const sel = new Set(plan.nodeIds)
  const path = subworkflowPathFor(opts.name, opts.folder, opts.exists)
  const uses = subworkflowUses(path)

  const inputs = plan.inputs.map((i, k) => ({ ...i, name: opts.inputNames?.[k] ?? i.name }))
  const outputs = plan.outputs.map((o, k) => ({ ...o, name: opts.outputNames?.[k] ?? o.name }))
  const inputBySource = new Map(inputs.map((i) => [i.source, i.name]))
  const outputBySource = new Map(outputs.map((o) => [o.source, o.name]))

  // The sub-workflow: Input, the moved nodes reading it, Output.
  const taken = new Set(plan.nodeIds)
  const inputId = uniqueId("Input", taken)
  taken.add(inputId)
  const outputId = uniqueId("Output", taken)
  const innerNodes: Record<string, NodeInstance> = {
    [inputId]: {
      uses: SUBWORKFLOW_INPUT,
      values: { fields: Object.fromEntries(inputs.map((i) => [i.name, i.type])) },
    },
  }
  for (const id of plan.nodeIds) {
    const node = wf.nodes[id] as NodeInstance
    let next = mapRefs(node, (ref, raw, _field, kind) => {
      if (sel.has(ref.nodeId) || !wf.nodes[ref.nodeId]) return raw
      if (kind === "when" && plan.when === raw && isRoot(node, sel)) return null
      for (let n = ref.path.length; n >= 0; n--) {
        const name = inputBySource.get(refString(ref.nodeId, ref.path.slice(0, n)))
        if (name !== undefined) return refString(inputId, [name, ...ref.path.slice(n)], ref.negate)
      }
      return raw
    })
    if (node.after) {
      const inside = node.after.filter((a) => sel.has(a))
      next = { ...next, after: inside }
      if (inside.length === 0) delete next.after
    }
    innerNodes[id] = next
  }
  const outputNode: NodeInstance = { uses: SUBWORKFLOW_OUTPUT }
  if (outputs.length > 0) outputNode.in = Object.fromEntries(outputs.map((o) => [o.name, o.source]))
  innerNodes[outputId] = outputNode

  const view = wf.view ?? {}
  const placed = plan.nodeIds
    .map((id) => view[id])
    .filter((p): p is { x: number; y: number } => !!p)
  const xs = placed.length > 0 ? placed.map((p) => p.x) : [0]
  const ys = placed.length > 0 ? placed.map((p) => p.y) : [0]
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const midY = (minY + Math.max(...ys)) / 2
  const innerView: Record<string, { x: number; y: number }> = {
    [inputId]: { x: 0, y: Math.round(midY - minY) },
  }
  plan.nodeIds.forEach((id, k) => {
    const p = view[id] ?? { x: minX + k * CARD_GAP, y: minY }
    innerView[id] = { x: p.x - minX + CARD_GAP, y: p.y - minY }
  })
  innerView[outputId] = { x: maxX - minX + 2 * CARD_GAP, y: Math.round(midY - minY) }
  const sub: WorkflowFile = { lorien: 1, label: opts.name, nodes: innerNodes, view: innerView }

  // The caller: the group becomes one node, and reads of it read its outputs.
  const outside = new Set(Object.keys(wf.nodes).filter((id) => !sel.has(id)))
  const firstId = plan.nodeIds[0] ?? ""
  const nodeId = uniqueId(nodeIdFor(opts.name, /^[a-z]/.test(firstId)), outside)
  const node: NodeInstance = { uses: uses }
  if (inputs.length > 0) node.in = Object.fromEntries(inputs.map((i) => [i.name, i.source]))
  if (plan.when) node.when = plan.when
  if (plan.after.length > 0) node.after = [...plan.after]

  const nodes: Record<string, NodeInstance> = {}
  for (const [id, n] of Object.entries(wf.nodes)) {
    if (sel.has(id)) {
      if (!(nodeId in nodes)) nodes[nodeId] = node
      continue
    }
    let next = mapRefs(n, (ref, raw) => {
      if (!sel.has(ref.nodeId)) return raw
      const port = ref.path[0]
      const name = outputBySource.get(refString(ref.nodeId, port === undefined ? [] : [port]))
      return name === undefined ? raw : refString(nodeId, [name, ...ref.path.slice(1)], ref.negate)
    })
    if (n.after?.some((a) => sel.has(a))) {
      next = { ...next, after: [...new Set(n.after.map((a) => (sel.has(a) ? nodeId : a)))] }
    }
    nodes[id] = next
  }

  const callerView = Object.fromEntries(Object.entries(view).filter(([id]) => !sel.has(id)))
  if (placed.length > 0) {
    callerView[nodeId] = {
      x: Math.round(placed.reduce((s, p) => s + p.x, 0) / placed.length),
      y: Math.round(placed.reduce((s, p) => s + p.y, 0) / placed.length),
    }
  }
  const caller: WorkflowFile = { ...wf, nodes }
  if (wf.view || placed.length > 0) caller.view = callerView

  return { caller, sub, nodeId, path }
}

function isRoot(node: NodeInstance, sel: Set<string>): boolean {
  return dataDeps(node).every((d) => !sel.has(d))
}

export type InlineResult =
  | { ok: true; workflow: WorkflowFile; nodeIds: string[] }
  | { ok: false; error: string }

function valueAt(value: unknown, path: string[]): unknown {
  let v = value
  for (const seg of path) v = (v as Record<string, unknown> | null | undefined)?.[seg]
  return v
}

/**
 * Replaces sub-workflow node `nodeId` with the nodes inside `sub`, wired
 * straight to what the node was wired to. The inverse of extracting.
 */
export function inlineSubworkflow(
  wf: WorkflowFile,
  nodeId: string,
  sub: WorkflowFile,
): InlineResult {
  const group = wf.nodes[nodeId]
  if (!group) return { ok: false, error: `${nodeId} isn't in this workflow` }
  if (typeof group.in === "string") {
    return {
      ok: false,
      error: `${nodeId} takes its whole input from one reference; wire its inputs one by one first`,
    }
  }
  const inputId = Object.keys(sub.nodes).find((id) => sub.nodes[id]?.uses === SUBWORKFLOW_INPUT)
  const outputId = Object.keys(sub.nodes).find((id) => sub.nodes[id]?.uses === SUBWORKFLOW_OUTPUT)
  const innerIds = Object.keys(sub.nodes).filter((id) => id !== inputId && id !== outputId)

  const taken = new Set(Object.keys(wf.nodes).filter((id) => id !== nodeId))
  const rename = new Map<string, string>()
  for (const id of innerIds) {
    const next = uniqueId(id, taken)
    taken.add(next)
    rename.set(id, next)
  }

  const wired = group.in ?? {}
  const literals = group.values ?? {}
  type Resolved = { ref: string } | { value: unknown } | null
  // A reference inside the sub-workflow, as the caller sees it: another
  // reference, a fixed value the caller typed, or null when nothing is wired.
  const resolve = (ref: Ref): Resolved => {
    if (ref.nodeId !== inputId) {
      return { ref: refString(rename.get(ref.nodeId) ?? ref.nodeId, ref.path, ref.negate) }
    }
    const [port = "", ...rest] = ref.path
    const src = parseRef(wired[port])
    if (src)
      return { ref: refString(src.nodeId, [...src.path, ...rest], ref.negate !== src.negate) }
    if (port in literals) return { value: valueAt(literals[port], rest) }
    return null
  }

  const added: Record<string, NodeInstance> = {}
  for (const id of innerIds) {
    const inner = sub.nodes[id] as NodeInstance
    const fixed: Record<string, unknown> = {}
    let neverRuns = false
    let next = mapRefs(inner, (ref, _raw, field, kind) => {
      const r = resolve(ref)
      if (r === null) return null
      if ("ref" in r) return r.ref
      if (kind === "when") {
        // A fixed value that lets it run: the condition goes.
        if (Boolean(r.value) === ref.negate) neverRuns = true
        return null
      }
      if (field !== null) fixed[field] = r.value
      return null
    })
    if (neverRuns) {
      return {
        ok: false,
        error: `${id} never runs: its condition reads a fixed value on ${nodeId}. Remove it from the sub-workflow first.`,
      }
    }
    if (Object.keys(fixed).length > 0)
      next = { ...next, values: { ...(next.values ?? {}), ...fixed } }

    // What gated the node gates the nodes that read its Input or read nothing.
    // Nodes that read another node inside are skipped along with it already.
    const deps = [...dataDeps(inner), ...(inner.after ?? [])]
    const readsInput = inputId !== undefined && deps.includes(inputId)
    const gated =
      deps.every((d) => d === inputId || !sub.nodes[d]) && (readsInput || deps.length === 0)
    if (gated && group.when && inner.uses !== "@core/variable") {
      if (next.when && next.when !== group.when) {
        return {
          ok: false,
          error: `${nodeId} has a run condition and so does ${id} inside it; inlining would have to merge them`,
        }
      }
      next.when = group.when
    }
    const after = [...(inner.after ?? []).map((a) => rename.get(a) ?? a)]
    if (gated) after.push(...(group.after ?? []))
    if (after.length > 0) next = { ...next, after: [...new Set(after)] }
    else delete next.after
    added[rename.get(id) as string] = next
  }

  const outMap = outputId ? sub.nodes[outputId]?.in : undefined
  const outs = outMap && typeof outMap === "object" ? outMap : {}
  const movedIds = innerIds.map((id) => rename.get(id) as string)
  const nodes: Record<string, NodeInstance> = {}
  for (const [id, n] of Object.entries(wf.nodes)) {
    if (id === nodeId) {
      Object.assign(nodes, added)
      continue
    }
    const fixed: Record<string, unknown> = {}
    let next = mapRefs(n, (ref, raw, field, kind) => {
      if (ref.nodeId !== nodeId) return raw
      const [port = "", ...rest] = ref.path
      const inner = parseRef(outs[port])
      const r = inner ? resolve(inner) : null
      if (r === null) return null
      if ("value" in r) {
        if (kind === "in" && field !== null) fixed[field] = valueAt(r.value, rest)
        return null
      }
      const resolved = parseRef(r.ref) as Ref
      return refString(resolved.nodeId, [...resolved.path, ...rest], ref.negate !== resolved.negate)
    })
    if (Object.keys(fixed).length > 0)
      next = { ...next, values: { ...(next.values ?? {}), ...fixed } }
    if (n.after?.includes(nodeId)) {
      next = {
        ...next,
        after: [...new Set(n.after.flatMap((a) => (a === nodeId ? movedIds : [a])))],
      }
    }
    nodes[id] = next
  }

  const view = { ...(wf.view ?? {}) }
  const at = view[nodeId] ?? { x: 0, y: 0 }
  delete view[nodeId]
  const innerView = sub.view ?? {}
  const placed = innerIds
    .map((id) => innerView[id])
    .filter((p): p is { x: number; y: number } => !!p)
  const minX = Math.min(...placed.map((p) => p.x))
  const minY = Math.min(...placed.map((p) => p.y))
  innerIds.forEach((id, k) => {
    const p = innerView[id]
    view[rename.get(id) as string] = p
      ? { x: at.x + p.x - minX, y: at.y + p.y - minY }
      : { x: at.x + k * CARD_GAP, y: at.y }
  })

  return { ok: true, workflow: { ...wf, nodes, view }, nodeIds: movedIds }
}
