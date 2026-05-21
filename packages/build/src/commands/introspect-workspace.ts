import { spawn } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, resolve as resolvePath } from "node:path"
import { fileURLToPath } from "node:url"

export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  // Other fields are tolerated but ignored.
  [key: string]: unknown
}

export interface NodeSchemas {
  inputs: JsonSchema
  outputs: JsonSchema
}

/** Built-in @core/* node schemas, hardcoded — they don't ship as user files. */
export const CORE_SCHEMAS: Record<string, NodeSchemas> = {
  "@core/http-request": {
    inputs: { type: "object", properties: {} },
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
}

interface CacheEntry {
  mtimeMs: number
  uses: string
  inputs: JsonSchema
  outputs: JsonSchema
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
      result[entry.uses] = { inputs: entry.inputs, outputs: entry.outputs }
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
        inputs: JsonSchema
        outputs: JsonSchema
      }
      const fileInfo = fileByUses.get(entry.uses)
      if (fileInfo) {
        cache.set(fileInfo.abs, {
          mtimeMs: fileInfo.mtimeMs,
          uses: entry.uses,
          inputs: entry.inputs,
          outputs: entry.outputs,
        })
      }
      result[entry.uses] = { inputs: entry.inputs, outputs: entry.outputs }
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

async function resolveTsx(workspaceRoot: string): Promise<string | null> {
  try {
    const require_ = createRequire(join(workspaceRoot, "package.json"))
    const pkgPath = require_.resolve("tsx/package.json")
    const pkgDir = dirname(pkgPath)
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
      bin?: Record<string, string> | string
    }
    const binField = pkg.bin
    const binEntry = typeof binField === "string" ? binField : binField?.["tsx"]
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
