import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import {
  CASES_SUFFIX,
  judgeCase,
  type MockFn,
  type NodeCase,
  type NodeCaseResult,
  parseCaseFile,
} from "../cases/index.js"
import { isHttpResponse, resolveCoreNode } from "../core/registry.js"
import { importNodes } from "../dev-server/import-nodes.js"
import { loadSubworkflows } from "../dev-server/load.js"
import { LifecycleEmitter } from "../exec/lifecycle.js"
import { runWorkflow } from "../exec/run.js"
import { computeExecutionPlan } from "../exec/topology.js"
import { loadProviders } from "../providers/load.js"
import type { AnyNodeOrTrigger, Node, Services } from "../types.js"
import {
  flattenWorkflow,
  type Subworkflow,
  type SubworkflowMap,
  subworkflowPorts,
} from "../workflow/flatten.js"
import { validateWorkflow } from "../workflow/validate.js"

export interface RunNodeCaseOptions {
  services?: Services
  /** Per-case time limit. Default 10s. */
  timeoutMs?: number
}

/**
 * Mocked provider methods return (or throw) synchronously, so they stand in
 * for sync clients like node:sqlite as well as async ones: `await` works on a
 * plain value, and a sync throw still lands in the node's try/catch.
 */
function buildMocks(
  mocks: NodeCase["mocks"],
): Record<string, Record<string, (...args: unknown[]) => unknown>> {
  const out: Record<string, Record<string, (...args: unknown[]) => unknown>> = {}
  for (const [svc, methods] of Object.entries(mocks ?? {})) {
    out[svc] = {}
    for (const [name, spec] of Object.entries(methods) as Array<[string, MockFn]>) {
      out[svc][name] = () => {
        if (spec.throws !== undefined) throw new Error(spec.throws)
        return structuredClone(spec.returns)
      }
    }
  }
  return out
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * Runs one case against a node the way the interpreter would: validate the
 * input against the node's schema, call `run()`, then check the output shape
 * and the case's expectation.
 */
export async function runNodeCase(
  node: Node,
  c: NodeCase,
  opts: RunNodeCaseOptions = {},
): Promise<NodeCaseResult> {
  const t0 = Date.now()
  const services = { ...(opts.services ?? {}), ...buildMocks(c.mocks) } as Services
  let output: unknown
  let error: string | undefined
  const failures: string[] = []
  try {
    const parsed = node.inputs.safeParse(c.input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw new Error(
        `input validation failed at \`${issue?.path?.join(".") || "<root>"}\`: ${issue?.message ?? "invalid"}`,
      )
    }
    const timeoutMs = opts.timeoutMs ?? 10_000
    let timer: ReturnType<typeof setTimeout> | undefined
    output = await Promise.race([
      node.run(parsed.data as never, services, undefined as never),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
    const shape = node.outputs.safeParse(output)
    if (!shape.success) {
      const issue = shape.error.issues[0]
      failures.push(
        `output does not match the node's outputs schema at \`${issue?.path?.join(".") || "<root>"}\`: ${issue?.message ?? "invalid"}`,
      )
    }
  } catch (e) {
    error = message(e)
  }
  failures.unshift(...judgeCase(c.expect, { output, ...(error !== undefined ? { error } : {}) }))
  return {
    caseId: c.id,
    name: c.name,
    passed: failures.length === 0,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
    failures,
    durationMs: Date.now() - t0,
  }
}

export interface RunSubworkflowCaseOptions extends RunNodeCaseOptions {
  /** The nodes it (and any sub-workflow inside it) uses, by `uses`. */
  nodes: Record<string, AnyNodeOrTrigger>
  /** Every sub-workflow in the project, for nested ones. */
  subworkflows: SubworkflowMap
}

const PRIMITIVE_FIELDS = new Set(["string", "number", "boolean"])

/**
 * Runs one case against a sub-workflow: the case's input goes in through its
 * Input node, and its output is what its Output node hands back. When a
 * Response inside answers first, the output is `{ response: { status, body } }`.
 */
export async function runSubworkflowCase(
  sub: Subworkflow,
  c: NodeCase,
  opts: RunSubworkflowCaseOptions,
): Promise<NodeCaseResult> {
  const t0 = Date.now()
  const services = { ...(opts.services ?? {}), ...buildMocks(c.mocks) } as Services
  let output: unknown
  let error: string | undefined
  try {
    const ports = subworkflowPorts(sub.file)
    if (!ports.inputId) throw new Error(`${sub.relativePath} has no Input node`)
    for (const [name, value] of Object.entries(c.input)) {
      if (!(name in ports.inputs)) {
        throw new Error(
          `input validation failed at \`${name}\`: not an input (inputs: ${Object.keys(ports.inputs).join(", ") || "none"})`,
        )
      }
      const type = ports.inputs[name]
      if (typeof type === "string" && PRIMITIVE_FIELDS.has(type) && typeof value !== type) {
        throw new Error(`input validation failed at \`${name}\`: expected ${type}`)
      }
    }
    const wf = flattenWorkflow(sub.file, opts.subworkflows, [sub.uses])
    const { errors, depsByNode } = validateWorkflow(wf)
    if (errors.length > 0) {
      throw new Error(errors.map((e) => `${e.nodeId}.${e.field}: ${e.message}`).join("; "))
    }
    const lifecycle = new LifecycleEmitter()
    let responded = false
    lifecycle.on("before-node", (ev) => {
      if (isHttpResponse(wf.nodes[ev.nodeId]?.uses ?? "")) responded = true
    })
    let handedBack: Record<string, unknown> | undefined
    const timeoutMs = opts.timeoutMs ?? 10_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      runWorkflow({
        workflow: wf,
        plan: computeExecutionPlan(wf, depsByNode),
        triggerNodeId: ports.inputId,
        triggerOutputs: c.input,
        services,
        lifecycle,
        resolveNode: (uses) => resolveCoreNode(uses) ?? opts.nodes[uses] ?? null,
        onAfterNode: async (nodeId, out) => {
          if (nodeId === ports.outputId) handedBack = out
        },
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
    output = responded
      ? { response: { status: result.status, body: result.body } }
      : (handedBack ?? {})
  } catch (e) {
    error = message(e)
  }
  const failures = judgeCase(c.expect, { output, ...(error !== undefined ? { error } : {}) })
  return {
    caseId: c.id,
    name: c.name,
    passed: failures.length === 0,
    ...(output !== undefined ? { output } : {}),
    ...(error !== undefined ? { error } : {}),
    failures,
    durationMs: Date.now() - t0,
  }
}

export interface NodeCaseFileResult {
  /** `nodes/users/save-user.cases.json` */
  path: string
  /** `./nodes/users/save-user` */
  uses: string
  error?: string
  results: NodeCaseResult[]
}

export interface RunNodeCasesOptions {
  root: string
  /** Defaults to importing `<root>/nodes/**`. */
  nodes?: Record<string, AnyNodeOrTrigger>
  /** Defaults to the `.workflow` files under `<root>/nodes`. */
  subworkflows?: SubworkflowMap
  /** Defaults to the services from `<root>/lorien.config.ts`. */
  services?: Services
  /** Only files whose path contains this text. */
  filter?: string
  /** Only these case ids (per file path). */
  only?: Record<string, string[]>
  timeoutMs?: number
}

export async function findCaseFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.name.endsWith(CASES_SUFFIX)) out.push(relative(root, abs).split(sep).join("/"))
    }
  }
  await walk(join(root, "nodes"))
  return out.sort()
}

/**
 * The providers (and legacy `lorien.config.ts` services) a node would get in
 * one request. When they can't be created (say an env var is missing), cases
 * still run: services they mock work, and the rest fail with a clear error.
 */
export async function loadConfiguredServices(root: string): Promise<Services> {
  try {
    const container = await loadProviders(root)
    const scope = await container.open({ requestId: `cases-${Date.now()}`, timestamp: Date.now() })
    return scope.values as Services
  } catch (e) {
    console.warn(`[lorien] providers unavailable for node cases: ${(e as Error).message}`)
    return {} as Services
  }
}

/** Runs every `nodes/**\/*.cases.json` against its node or sub-workflow. */
export async function runNodeCases(opts: RunNodeCasesOptions): Promise<NodeCaseFileResult[]> {
  const files = (await findCaseFiles(opts.root)).filter(
    (f) => !opts.filter || f.includes(opts.filter),
  )
  if (files.length === 0) return []
  const imported = opts.nodes ? null : await importNodes(opts.root)
  const nodes = opts.nodes ?? imported?.nodes ?? {}
  const services = opts.services ?? (await loadConfiguredServices(opts.root))
  const subworkflows = opts.subworkflows ?? (await loadSubworkflows(opts.root))
  const out: NodeCaseFileResult[] = []
  for (const path of files) {
    const uses = `./${path.slice(0, -CASES_SUFFIX.length)}`
    const node = nodes[uses]
    const sub = subworkflows[uses]
    if (!sub && (!node || node.kind !== "node")) {
      const file = join(opts.root, `${uses.slice(2)}.ts`)
      const importError = imported?.errors.find((e) => e.path === file)
      out.push({
        path,
        uses,
        error: importError
          ? `couldn't import ${uses.slice(2)}.ts: ${importError.message}`
          : `no node found at ${uses.slice(2)}.ts`,
        results: [],
      })
      continue
    }
    let cases: NodeCase[]
    try {
      cases = parseCaseFile(await readFile(join(opts.root, path), "utf-8"), path).cases
    } catch (e) {
      out.push({ path, uses, error: message(e), results: [] })
      continue
    }
    const only = opts.only?.[path]
    const results: NodeCaseResult[] = []
    for (const c of cases) {
      if (only && !only.includes(c.id)) continue
      const timeout = opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}
      results.push(
        sub
          ? await runSubworkflowCase(sub, c, { services, nodes, subworkflows, ...timeout })
          : await runNodeCase(node as Node, c, { services, ...timeout }),
      )
    }
    out.push({ path, uses, results })
  }
  return out
}
