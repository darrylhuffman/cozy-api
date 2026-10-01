import { isHttpResponse } from "../core/registry.js"
import type { NodeMock } from "../requests/types.js"
import type { AnyNodeOrTrigger, Node, Services } from "../types.js"
import { dataDependencies, nodeDependencies, parseWhen } from "../workflow/dependencies.js"
import { referenceSource } from "../workflow/flatten.js"
import { parseReference } from "../workflow/reference.js"
import type { NodeInstance, WorkflowFile } from "../workflow/types.js"
import { NodeRunError, type RequestIssue, RequestValidationError } from "./errors.js"
import type { LifecycleEmitter } from "./lifecycle.js"
import type { ExecutionPlan } from "./topology.js"

export interface WorkflowRunResult {
  status: number
  body: unknown
  headers: Record<string, string>
}

export interface RunWorkflowOptions {
  workflow: WorkflowFile
  plan: ExecutionPlan
  /** Which trigger node fired this run. */
  triggerNodeId: string
  /** The outputs of the trigger node, pre-resolved by the host (HTTP request data, etc.). */
  triggerOutputs: Record<string, unknown>
  services: Services
  /** Maps a node's `uses` string to its Node/Trigger object. */
  resolveNode: (uses: string) => AnyNodeOrTrigger | null
  lifecycle?: LifecycleEmitter
  /**
   * Optional async hook called immediately after Zod input validation, before
   * the node's `run()` executes. Dev-only (the debugger uses this to pause).
   * If undefined, the interpreter does not await anything here — zero overhead.
   * If the returned promise rejects, the rejection is wrapped in a
   * `NodeRunError` and the workflow halts per existing fail-fast semantics.
   */
  onBeforeNode?: (nodeId: string, input: Record<string, unknown>) => Promise<void>
  /**
   * Optional async hook called immediately after a node's `run()` returns,
   * after the corresponding `after-node` lifecycle event has been emitted,
   * before downstream nodes can consume the output. Not called when `run()`
   * throws (use lifecycle `error` events for that). Not called for
   * @core/http-response (which short-circuits without `outputs.set`).
   */
  onAfterNode?: (nodeId: string, output: Record<string, unknown>) => Promise<void>
  /**
   * Node id → what the node returns (or throws) instead of running. Inputs are
   * still resolved and validated. Used by request tests; never set in production.
   */
  mocks?: Record<string, NodeMock>
}

/**
 * Compute the set of nodes that must execute when `triggerNodeId` fires.
 *
 * A node's "trigger owners" are the triggers from which it is forward-reachable.
 * - Nodes owned by the firing trigger run (they're downstream of it).
 * - Nodes with no trigger owners (orphans) also run — there is no other
 *   trigger claiming them, and they are typically required to compute outputs.
 * - Nodes owned exclusively by *other* triggers are skipped (multi-trigger
 *   workflows: don't cross-fire between independent subgraphs).
 *
 * Additionally, we include the transitive upstream ancestors of every
 * already-included node, so a downstream node's data dependencies are always
 * satisfied even when they live in an orphan subgraph.
 */
function computeExecutionSet(
  workflow: WorkflowFile,
  plan: ExecutionPlan,
  triggerNodeId: string,
): Set<string> {
  const allIds = Object.keys(workflow.nodes)
  const ownersOf = new Map<string, Set<string>>()
  for (const id of allIds) ownersOf.set(id, new Set())
  for (const [trigId, reach] of plan.reachableFrom) {
    for (const id of reach) ownersOf.get(id)?.add(trigId)
  }

  const execSet = new Set<string>()
  for (const id of allIds) {
    const owners = ownersOf.get(id) ?? new Set()
    if (owners.has(triggerNodeId) || owners.size === 0) execSet.add(id)
  }
  execSet.add(triggerNodeId)

  // Build deps adjacency to walk upstream ancestors.
  const depsOf = new Map<string, Set<string>>()
  for (const [id, inst] of Object.entries(workflow.nodes)) {
    depsOf.set(id, new Set(nodeDependencies(inst)))
  }

  // Foreign triggers: every trigger in the workflow that ISN'T the firing one.
  // The execution-plan's `reachableFrom` keys are exactly the trigger nodes
  // discovered by topology.ts; anything keyed there but not equal to the
  // firing trigger is "another trigger's entrypoint" and must be excluded
  // from this run — including from the ancestor walk below. This preserves
  // the spec's "each trigger's run is independent" semantics: ancestor walking
  // from a shared downstream node must not pull a sibling trigger (and its
  // subgraph) into the execution set.
  const foreignTriggers = new Set<string>()
  for (const trigId of plan.reachableFrom.keys()) {
    if (trigId !== triggerNodeId) foreignTriggers.add(trigId)
  }

  // BFS upstream from every reachable node to include all transitive ancestors,
  // skipping foreign triggers (and not recursing into their ancestors).
  const queue: string[] = [...execSet]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    for (const dep of depsOf.get(cur) ?? []) {
      if (foreignTriggers.has(dep)) continue
      if (!execSet.has(dep)) {
        execSet.add(dep)
        queue.push(dep)
      }
    }
  }

  return execSet
}

export async function runWorkflow(opts: RunWorkflowOptions): Promise<WorkflowRunResult> {
  const { workflow, plan, triggerNodeId, triggerOutputs, lifecycle } = opts

  const startedAt = Date.now()
  const outputs = new Map<string, Record<string, unknown>>()
  outputs.set(triggerNodeId, triggerOutputs)

  const execSet = computeExecutionSet(workflow, plan, triggerNodeId)

  let responseResult: WorkflowRunResult | null = null
  // Nodes whose `when` was false, or that read a skipped node's outputs.
  const skipped = new Set<string>()

  for (const wave of plan.waves) {
    const tasks: Promise<void>[] = []
    // Responses that ran in this wave, in wave order: the first one answers.
    const responses: Array<WorkflowRunResult | null> = []
    for (const nodeId of wave) {
      if (!execSet.has(nodeId)) continue
      if (nodeId !== triggerNodeId && isSkipped(nodeId, workflow, outputs, skipped)) {
        skipped.add(nodeId)
        lifecycle?.emit({ type: "skipped", nodeId })
        continue
      }
      if (nodeId === triggerNodeId) {
        lifecycle?.emit({ type: "before-node", nodeId, input: {} })
        if (opts.onBeforeNode) {
          try {
            await opts.onBeforeNode(nodeId, {})
          } catch (err) {
            throw new NodeRunError(nodeId, err)
          }
        }
        lifecycle?.emit({
          type: "after-node",
          nodeId,
          output: triggerOutputs as Record<string, unknown>,
          durationMs: 0,
        })
        if (opts.onAfterNode) {
          try {
            await opts.onAfterNode(nodeId, triggerOutputs as Record<string, unknown>)
          } catch (err) {
            throw new NodeRunError(nodeId, err)
          }
        }
        continue
      }
      const slot = responses.push(null) - 1
      tasks.push(
        runOneNode(nodeId, opts, outputs, lifecycle).then((res) => {
          if (res?.kind === "response") responses[slot] = res.value
        }),
      )
    }
    if (tasks.length > 0) {
      // Per spec §3.5: "If any node throws, the workflow halts. In-flight
      // sibling nodes are awaited (so dispose()s run on services) but their
      // results are discarded." Promise.all would reject fast and leave
      // siblings as unhandled rejections; allSettled awaits all, then we
      // rethrow the first failure.
      const settled = await Promise.allSettled(tasks)
      const rejection = settled.find((s) => s.status === "rejected")
      if (rejection) throw (rejection as PromiseRejectedResult).reason
    }
    responseResult = responses.find((r) => r !== null) ?? null
    if (responseResult) break
  }

  lifecycle?.emit({ type: "complete", totalMs: Date.now() - startedAt })

  if (responseResult) return responseResult
  return { status: 200, body: null, headers: {} }
}

/**
 * True when a node shouldn't run: it reads the outputs of a skipped node, or
 * its `when` reference is falsy (truthy, with a leading `!`).
 */
function isSkipped(
  nodeId: string,
  workflow: WorkflowFile,
  outputs: Map<string, Record<string, unknown>>,
  skipped: Set<string>,
): boolean {
  const inst = workflow.nodes[nodeId]
  if (!inst) return false
  if (dataDependencies(inst).some((dep) => skipped.has(dep))) return true
  if (inst.when === undefined) return false
  const when = parseWhen(inst.when)
  if (!when) return false
  let v: unknown = outputs.get(when.ref.nodeId)
  for (const seg of when.ref.path) v = (v as Record<string, unknown> | null | undefined)?.[seg]
  return Boolean(v) === when.negate
}

/**
 * The failed issues whose values came straight from the trigger (the HTTP
 * request), located in the request: `in.minCapacity: "Request.query.minCapacity"`
 * failing becomes "query.minCapacity".
 */
function requestIssues(
  workflow: WorkflowFile,
  instance: NodeInstance,
  triggerNodeId: string,
  issues: Array<{ path: PropertyKey[]; message: string }>,
): RequestIssue[] {
  const out: RequestIssue[] = []
  for (const issue of issues) {
    const path = issue.path.map(String)
    let ref: ReturnType<typeof parseReference> = null
    let rest = path
    if (typeof instance.in === "string") {
      ref = referenceSource(workflow, instance.in)
    } else {
      const raw = path[0] !== undefined ? instance.in?.[path[0]] : undefined
      ref = raw !== undefined ? referenceSource(workflow, raw) : null
      rest = path.slice(1)
    }
    if (ref?.nodeId !== triggerNodeId) continue
    out.push({ path: [...ref.path, ...rest].join("."), message: issue.message })
  }
  return out
}

interface RunNodeResult {
  kind: "response"
  value: WorkflowRunResult
}

async function runOneNode(
  nodeId: string,
  opts: RunWorkflowOptions,
  outputs: Map<string, Record<string, unknown>>,
  lifecycle: LifecycleEmitter | undefined,
): Promise<RunNodeResult | null> {
  const instance = opts.workflow.nodes[nodeId]
  if (!instance) return null
  const nodeDef = opts.resolveNode(instance.uses)
  if (!nodeDef) {
    throw new NodeRunError(nodeId, new Error(`unresolved \`uses\`: ${instance.uses}`))
  }

  // Resolve inputs. The shape is:
  //  - `values:` provides the literal floor (per-field, JSON-serializable).
  //  - `in: "ref"`    → resolved value REPLACES the whole input bag (whole-object form).
  //  - `in: {...}`    → per-field reference strings; each overrides values[field].
  //
  // Precedence for a given field, in order from lowest to highest:
  //   instance.values[field] < instance.in[field] (reference, resolved)
  // The whole-object form replaces everything, so `values` is ignored when
  // `in` is a string.
  let input: Record<string, unknown> = {}
  if (typeof instance.in === "string") {
    const ref = parseReference(instance.in)
    if (!ref) {
      throw new NodeRunError(
        nodeId,
        new Error(
          `whole-object \`in\` must be a node reference, got: ${JSON.stringify(instance.in)}`,
        ),
      )
    }
    const upstream = outputs.get(ref.nodeId)
    if (!upstream) {
      throw new NodeRunError(nodeId, new Error(`upstream \`${ref.nodeId}\` produced no output`))
    }
    let v: unknown = upstream
    for (const seg of ref.path) {
      v = (v as Record<string, unknown> | null | undefined)?.[seg]
    }
    // The resolved value IS the input bag. If it's not an object, Zod will fail
    // shortly — we don't want to coerce here.
    input = (v ?? {}) as Record<string, unknown>
    lifecycle?.emit({
      type: "edge-fired",
      from: `${ref.nodeId}.${ref.path.join(".")}`,
      to: `${nodeId}.$`,
      value: v,
    })
  } else {
    // 1) Start with literal values from `values:` (the floor).
    if (instance.values && typeof instance.values === "object") {
      for (const [k, v] of Object.entries(instance.values)) {
        input[k] = v
      }
    }
    // 2) Overlay per-field references from `in:`.
    for (const [field, raw] of Object.entries(instance.in ?? {})) {
      const ref = parseReference(raw)
      if (!ref) {
        throw new NodeRunError(
          nodeId,
          new Error(`\`in.${field}\` must be a node reference, got: ${JSON.stringify(raw)}`),
        )
      }
      const upstream = outputs.get(ref.nodeId)
      if (!upstream) {
        throw new NodeRunError(nodeId, new Error(`upstream \`${ref.nodeId}\` produced no output`))
      }
      let v: unknown = upstream
      for (const seg of ref.path) {
        v = (v as Record<string, unknown> | null | undefined)?.[seg]
      }
      input[field] = v
      lifecycle?.emit({
        type: "edge-fired",
        from: `${ref.nodeId}.${ref.path.join(".")}`,
        to: `${nodeId}.${field}`,
        value: v,
      })
    }
  }

  // Special-case @core/http-response: collect status/body/headers and short-circuit.
  if (isHttpResponse(instance.uses)) {
    lifecycle?.emit({ type: "before-node", nodeId, input })
    if (opts.onBeforeNode) {
      try {
        await opts.onBeforeNode(nodeId, input)
      } catch (err) {
        throw new NodeRunError(nodeId, err)
      }
    }
    const response: WorkflowRunResult = {
      status: (input.status as number | undefined) ?? 200,
      body: input.body,
      headers: (input.headers as Record<string, string> | undefined) ?? {},
    }
    lifecycle?.emit({
      type: "after-node",
      nodeId,
      output: { sent: true },
      durationMs: 0,
    })
    // onAfterNode is intentionally NOT called for @core/http-response — no outputs exposed downstream.
    return { kind: "response", value: response }
  }

  if (nodeDef.kind !== "node") {
    // Non-response trigger nodes are already handled in runWorkflow.
    return null
  }

  // Validate the resolved input bag against the node's Zod schema before run().
  let validatedInput: Record<string, unknown> = input
  if (nodeDef.inputs) {
    const result = (nodeDef as Node).inputs.safeParse(input)
    if (!result.success) {
      const fromRequest = requestIssues(
        opts.workflow,
        instance,
        opts.triggerNodeId,
        result.error.issues,
      )
      if (fromRequest.length > 0) throw new RequestValidationError(nodeId, fromRequest)
      const issue = result.error.issues[0]
      const path = issue?.path?.join(".") ?? "<root>"
      const message = issue?.message ?? "validation failed"
      throw new NodeRunError(
        nodeId,
        new Error(`input validation failed at \`${path}\`: ${message}`),
      )
    }
    validatedInput = result.data as Record<string, unknown>
  }

  lifecycle?.emit({ type: "before-node", nodeId, input: validatedInput })
  if (opts.onBeforeNode) {
    try {
      await opts.onBeforeNode(nodeId, validatedInput)
    } catch (err) {
      throw new NodeRunError(nodeId, err)
    }
  }
  const t0 = Date.now()
  const mock = opts.mocks?.[nodeId]
  let output: Record<string, unknown>
  try {
    if (mock?.error !== undefined) throw new Error(mock.error)
    output = mock
      ? (mock.output ?? {})
      : ((await (nodeDef as Node).run(
          validatedInput as never,
          opts.services,
          undefined as never,
        )) as Record<string, unknown>)
  } catch (err) {
    lifecycle?.emit({ type: "error", nodeId, error: err as Error })
    throw new NodeRunError(nodeId, err)
  }
  // A node returning the wrong shape would pass bad data downstream (or into
  // the response); stop at the node that broke its contract. Mocks are partial
  // by design and skip this.
  if (!mock && (nodeDef as Node).outputs) {
    const checked = (nodeDef as Node).outputs.safeParse(output)
    if (!checked.success) {
      const issue = checked.error.issues[0]
      const err = new Error(
        `output doesn't match its outputs schema at \`${issue?.path?.join(".") || "<root>"}\`: ${issue?.message ?? "invalid"}`,
      )
      lifecycle?.emit({ type: "error", nodeId, error: err })
      throw new NodeRunError(nodeId, err)
    }
  }
  lifecycle?.emit({
    type: "after-node",
    nodeId,
    output,
    durationMs: Date.now() - t0,
  })
  if (opts.onAfterNode) {
    try {
      await opts.onAfterNode(nodeId, output)
    } catch (err) {
      throw new NodeRunError(nodeId, err)
    }
  }
  outputs.set(nodeId, output)
  return null
}
