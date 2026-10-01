import { spawn } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"
import {
  loadSubworkflows,
  parseReference,
  SUBWORKFLOW_INPUT,
  SUBWORKFLOW_OUTPUT,
  type SubworkflowMap,
  subworkflowPorts,
} from "@darrylondil/lorien-runtime"

export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  // Other fields are tolerated but ignored.
  [key: string]: unknown
}

export interface NodeSchemas {
  /** Human-readable display name from defineNode({ name }). Null when unset. */
  name?: string | null
  inputs: JsonSchema
  outputs: JsonSchema
  /** Optional accent color (free-form CSS string). Null when unset. */
  color?: string | null
  /** Leading TSDoc/JSDoc extracted from the node source file. Null when absent. */
  description?: string | null
  /** Set when the node is a sub-workflow (a `.workflow` file under nodes/). */
  subworkflow?: SubworkflowInfo
}

export interface SubworkflowInfo {
  /** Project-relative file, e.g. "nodes/orders/reserve-seats.workflow". */
  path: string
  /** Statuses its Response nodes can answer with, e.g. [404, 409]. */
  respondsWith: number[]
  /** Nodes inside, not counting its Input and Output. */
  nodeCount: number
}

/** Built-in @core/* node schemas, hardcoded — they don't ship as user files. */
export const CORE_SCHEMAS: Record<string, NodeSchemas> = {
  "@core/http-request": {
    name: "HTTP Request",
    color: null,
    description:
      "HTTP request trigger. The `method` and `path` inputs define the route this workflow handles. The path defaults to the workflow's folder location.",
    inputs: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          default: "GET",
        },
        path: {
          type: "string",
          default: "{workflow_path}",
        },
        body: { type: "object", description: "Request body (POST/PUT/PATCH only)" },
      },
      required: ["method", "path"],
    },
    outputs: {
      type: "object",
      properties: {
        body: { type: "object" },
        params: { type: "object", additionalProperties: { type: "string" } },
        query: { type: "object", additionalProperties: { type: "string" } },
        headers: { type: "object", additionalProperties: { type: "string" } },
        context: {
          type: "object",
          properties: {
            requestId: { type: "string" },
            timestamp: { type: "number" },
          },
        },
      },
    },
  },
  "@core/response": {
    name: "Response",
    color: null,
    inputs: {
      type: "object",
      properties: {
        body: {},
        status: { type: "number" },
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    outputs: { type: "object", properties: {} },
  },
  "@core/schedule": {
    name: "Schedule",
    color: null,
    description:
      "Schedule trigger. Starts this workflow at the times its cron expression names, in its time zone (UTC unless set). `lorien dev` and the built server keep the timers; in the IDE, Run now starts it by hand.",
    inputs: {
      type: "object",
      properties: {
        cron: {
          type: "string",
          default: "0 9 * * *",
          description: "Five-field cron expression: minute hour day-of-month month day-of-week",
        },
        timezone: { type: "string", default: "UTC", description: "IANA time zone" },
      },
      required: ["cron"],
    },
    outputs: {
      type: "object",
      properties: {
        scheduledAt: { type: "string", description: "The time this run was due, as ISO 8601" },
        timestamp: { type: "number" },
        manual: { type: "boolean", description: "True when started with Run now" },
        context: { type: "object", properties: { runId: { type: "string" } } },
      },
    },
  },
  "@core/input": {
    name: "Input",
    color: null,
    description:
      "Where a sub-workflow starts. Each field under `values.fields` (name: type) is an input on the sub-workflow's card; nodes inside read it as `<id>.<field>`.",
    inputs: { type: "object", properties: {} },
    outputs: { type: "object", additionalProperties: true },
  },
  "@core/output": {
    name: "Output",
    color: null,
    description:
      "Where a sub-workflow ends. Each wired input is an output on the sub-workflow's card. If this node is skipped, so is everything reading the sub-workflow.",
    inputs: { type: "object", additionalProperties: true },
    outputs: { type: "object", properties: {} },
  },
  "@core/variable": {
    name: "Variable",
    color: null,
    description:
      "A named constant. Other nodes read it as `<id>.value`. Drag an input's handle onto empty canvas to make one typed for that input.",
    inputs: { type: "object", properties: { value: {} } },
    outputs: { type: "object", properties: { value: {} } },
  },
}

interface CacheEntry {
  mtimeMs: number
  uses: string
  name: string | null
  inputs: JsonSchema
  outputs: JsonSchema
  color: string | null
  description: string | null
}

/**
 * In-process cache keyed by absolute file path. Cleared when the file's mtime
 * changes (we re-introspect everything in one shot; selective updates would
 * require a more complex worker protocol).
 */
const cache = new Map<string, CacheEntry>()

/**
 * Invalidates a single file in the cache. Used by the SSE file-watcher when
 * a node file changes / is added / is removed.
 */
export function invalidateSchemaCache(absPath: string): void {
  cache.delete(absPath)
}

/** Clears the entire schema cache. */
export function clearSchemaCache(): void {
  cache.clear()
}

export interface IntrospectResult {
  schemas: Record<string, NodeSchemas>
  /** Non-fatal warnings (e.g. tsx not found, individual node import failures). */
  warnings: string[]
}

/**
 * Returns the union of @core/* schemas + user node schemas. Best-effort: if
 * tsx is not installed in the workspace, only @core schemas are returned.
 *
 * Files whose mtime hasn't changed since the last call are served from the
 * cache without re-spawning the worker — except that the worker doesn't yet
 * support a "only these files" mode, so we shortcut the whole call when the
 * cache covers every .ts file we find.
 */
export async function introspectWorkspace(workspaceRoot: string): Promise<IntrospectResult> {
  const result = await introspectNodeFiles(workspaceRoot)
  const errors: Array<{ path: string; message: string }> = []
  const subworkflows = await loadSubworkflows(workspaceRoot, errors)
  for (const e of errors) result.warnings.push(`${e.path}: ${e.message}`)
  Object.assign(result.schemas, subworkflowSchemas(subworkflows, result.schemas))
  return result
}

/** A sub-workflow Input field's type: a type name ("string") or a JSON Schema. */
function fieldSchema(type: unknown): JsonSchema {
  if (type && typeof type === "object" && !Array.isArray(type)) return type as JsonSchema
  if (type === "json") return { type: "object" }
  return typeof type === "string" && type !== "" ? { type } : {}
}

/**
 * Schemas for sub-workflows, so the IDE draws their ports like any node's:
 * inputs from the Input node's fields, outputs typed from what the Output
 * node reads (through nested sub-workflows too).
 */
export function subworkflowSchemas(
  subworkflows: SubworkflowMap,
  nodeSchemas: Record<string, NodeSchemas>,
): Record<string, NodeSchemas> {
  const out: Record<string, NodeSchemas> = {}
  const visiting = new Set<string>()
  const schemaFor = (uses: string): NodeSchemas | undefined => {
    if (out[uses] || nodeSchemas[uses]) return out[uses] ?? nodeSchemas[uses]
    const sub = subworkflows[uses]
    if (!sub || visiting.has(uses)) return undefined
    visiting.add(uses)
    const { file } = sub
    const ports = subworkflowPorts(file)
    const inputs: Record<string, JsonSchema> = {}
    for (const [name, type] of Object.entries(ports.inputs)) inputs[name] = fieldSchema(type)
    const outputs: Record<string, JsonSchema> = {}
    const outMap = ports.outputId ? file.nodes[ports.outputId]?.in : undefined
    for (const [name, raw] of Object.entries(typeof outMap === "object" ? outMap : {})) {
      const ref = parseReference(raw)
      const source = ref ? file.nodes[ref.nodeId] : undefined
      let schema: JsonSchema | undefined
      if (ref && source?.uses === SUBWORKFLOW_INPUT) {
        schema = ref.path[0] !== undefined ? inputs[ref.path[0]] : undefined
        for (const seg of ref.path.slice(1)) schema = schema?.properties?.[seg]
      } else if (ref && source) {
        schema = schemaFor(source.uses)?.outputs
        for (const seg of ref.path) schema = schema?.properties?.[seg]
      }
      outputs[name] = schema ?? {}
    }
    const respondsWith = Object.values(file.nodes)
      .filter((n) => n.uses === "@core/response")
      .map((n) =>
        n.in && typeof n.in === "object" && "status" in n.in ? null : (n.values?.status ?? 200),
      )
      .filter((s): s is number => typeof s === "number")
    const base = uses.split("/").pop() ?? uses
    out[uses] = {
      name: file.label ?? base.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
      color: null,
      description: null,
      inputs: { type: "object", properties: inputs },
      outputs: { type: "object", properties: outputs },
      subworkflow: {
        path: sub.relativePath,
        respondsWith: [...new Set(respondsWith)].sort((a, b) => a - b),
        nodeCount: Object.values(file.nodes).filter(
          (n) => n.uses !== SUBWORKFLOW_INPUT && n.uses !== SUBWORKFLOW_OUTPUT,
        ).length,
      },
    }
    visiting.delete(uses)
    return out[uses]
  }
  for (const uses of Object.keys(subworkflows)) schemaFor(uses)
  return out
}

async function introspectNodeFiles(workspaceRoot: string): Promise<IntrospectResult> {
  const warnings: string[] = []

  const result: Record<string, NodeSchemas> = { ...CORE_SCHEMAS }

  // Find tsx
  const tsxPath = await resolveTsx(workspaceRoot)
  if (!tsxPath) {
    warnings.push(
      "tsx not found in workspace node_modules — only @core/* schemas will be available.",
    )
    return { schemas: result, warnings }
  }

  // Try the cache: list nodes, see if all are present + fresh
  const nodeFiles = await listNodeFiles(workspaceRoot)
  if (nodeFiles.length === 0) {
    return { schemas: result, warnings }
  }

  let allCached = true
  for (const file of nodeFiles) {
    const cached = cache.get(file.abs)
    if (!cached || cached.mtimeMs !== file.mtimeMs) {
      allCached = false
      break
    }
  }

  if (allCached) {
    for (const file of nodeFiles) {
      const entry = cache.get(file.abs)!
      result[entry.uses] = {
        name: entry.name,
        inputs: entry.inputs,
        outputs: entry.outputs,
        color: entry.color,
        description: entry.description,
      }
    }
    return { schemas: result, warnings }
  }

  // Cache miss — spawn worker and refresh everything
  const workerPath = await resolveWorkerPath()
  const lines = await runWorker(tsxPath, workerPath, workspaceRoot, warnings)

  // Rebuild cache from worker output, then merge with file mtimes
  const fileByUses = new Map<string, { abs: string; mtimeMs: number }>()
  for (const file of nodeFiles) {
    // Convert "<root>/nodes/foo/bar.ts" to "./nodes/foo/bar"
    const usesKey = `./${file.rel.replaceAll("\\", "/").replace(/\.ts$/, "")}`
    fileByUses.set(usesKey, file)
  }

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as {
        uses: string
        name?: string | null
        inputs: JsonSchema
        outputs: JsonSchema
        color?: string | null
        description?: string | null
      }
      const name = entry.name ?? null
      const color = entry.color ?? null
      const description = entry.description ?? null
      const fileInfo = fileByUses.get(entry.uses)
      if (fileInfo) {
        cache.set(fileInfo.abs, {
          mtimeMs: fileInfo.mtimeMs,
          uses: entry.uses,
          name,
          inputs: entry.inputs,
          outputs: entry.outputs,
          color,
          description,
        })
      }
      result[entry.uses] = {
        name,
        inputs: entry.inputs,
        outputs: entry.outputs,
        color,
        description,
      }
    } catch (e) {
      warnings.push(`Failed to parse worker output line: ${(e as Error).message}`)
    }
  }

  return { schemas: result, warnings }
}

interface NodeFile {
  abs: string
  rel: string
  mtimeMs: number
}

async function listNodeFiles(workspaceRoot: string): Promise<NodeFile[]> {
  const out: NodeFile[] = []
  const nodesDir = join(workspaceRoot, "nodes")
  try {
    const s = await stat(nodesDir)
    if (!s.isDirectory()) return out
  } catch {
    return out
  }

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (
        entry.name.endsWith(".ts") &&
        !entry.name.endsWith(".test.ts") &&
        !entry.name.endsWith(".test-d.ts")
      ) {
        const st = await stat(full)
        out.push({
          abs: full,
          rel: full.slice(workspaceRoot.length + 1),
          mtimeMs: st.mtimeMs,
        })
      }
    }
  }

  await walk(nodesDir)
  return out
}

export async function resolveTsx(workspaceRoot: string): Promise<string | null> {
  try {
    const require_ = createRequire(join(workspaceRoot, "package.json"))
    const pkgPath = require_.resolve("tsx/package.json")
    const pkgDir = dirname(pkgPath)
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      bin?: Record<string, string> | string
    }
    const binField = pkg.bin
    const binEntry = typeof binField === "string" ? binField : binField?.tsx
    if (!binEntry) return null
    return resolvePath(pkgDir, binEntry)
  } catch {
    return null
  }
}

async function resolveWorkerPath(): Promise<string> {
  // In production (built), this file lives in `<build>/dist/cli.js` (or
  // `<build>/dist/introspect-workspace.js`) and the worker is next to it as
  // `introspect-worker.js`. In dev/tests, we're running from
  // `<build>/src/commands/introspect-workspace.ts`, and the worker source is
  // `introspect-worker.ts` in the same directory.
  const here = fileURLToPath(import.meta.url)
  const hereDir = dirname(here)
  const candidates = [join(hereDir, "introspect-worker.js"), join(hereDir, "introspect-worker.ts")]
  for (const c of candidates) {
    try {
      const s = await stat(c)
      if (s.isFile()) return c
    } catch {
      // try next
    }
  }
  // Fallback to the .js form even if it doesn't exist — caller will warn.
  return candidates[0]!
}

/**
 * Spawns tsx with the worker script + workspaceRoot, captures stdout NDJSON.
 * Returns the array of raw lines.
 */
function runWorker(
  tsxPath: string,
  workerPath: string,
  workspaceRoot: string,
  warnings: string[],
): Promise<string[]> {
  return new Promise((resolveP) => {
    // If workerPath is a .ts (dev mode), tsx handles it; if .js, also fine.
    // Try worker .js first, then fall back to .ts in src/ for dev/test runs.
    const child = spawn(process.execPath, [tsxPath, workerPath, workspaceRoot], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8")
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8")
    })
    child.on("error", (err) => {
      warnings.push(`worker spawn error: ${err.message}`)
      resolveP([])
    })
    child.on("exit", (code) => {
      if (stderr.trim()) warnings.push(`worker stderr: ${stderr.trim()}`)
      if (code !== 0 && code !== null) {
        warnings.push(`worker exited with code ${code}`)
      }
      const lines = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
      resolveP(lines)
    })
  })
}
