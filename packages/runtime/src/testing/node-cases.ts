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
import { importNodes } from "../dev-server/import-nodes.js"
import { loadProviders } from "../providers/load.js"
import type { AnyNodeOrTrigger, Node, Services } from "../types.js"

export interface RunNodeCaseOptions {
  services?: Services
  /** Per-case time limit. Default 10s. */
  timeoutMs?: number
}

function buildMocks(
  mocks: NodeCase["mocks"],
): Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> {
  const out: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {}
  for (const [svc, methods] of Object.entries(mocks ?? {})) {
    out[svc] = {}
    for (const [name, spec] of Object.entries(methods) as Array<[string, MockFn]>) {
      out[svc][name] = async () => {
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

/** Runs every `nodes/**\/*.cases.json` against its node. */
export async function runNodeCases(opts: RunNodeCasesOptions): Promise<NodeCaseFileResult[]> {
  const files = (await findCaseFiles(opts.root)).filter(
    (f) => !opts.filter || f.includes(opts.filter),
  )
  if (files.length === 0) return []
  const nodes = opts.nodes ?? (await importNodes(opts.root)).nodes
  const services = opts.services ?? (await loadConfiguredServices(opts.root))
  const out: NodeCaseFileResult[] = []
  for (const path of files) {
    const uses = `./${path.slice(0, -CASES_SUFFIX.length)}`
    const node = nodes[uses]
    if (!node || node.kind !== "node") {
      out.push({ path, uses, error: `no node found at ${uses.slice(2)}.ts`, results: [] })
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
      results.push(
        await runNodeCase(node as Node, c, {
          services,
          ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
        }),
      )
    }
    out.push({ path, uses, results })
  }
  return out
}
