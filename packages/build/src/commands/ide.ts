import { spawn } from "node:child_process"
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import type { Server as HttpServer } from "node:http"
import { createRequire } from "node:module"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import {
  type AnyNodeOrTrigger,
  attachDebugWebSocket,
  type DebugIntegration,
  DebugSession,
  importNodes,
  installConsoleCapture,
  isLoopbackOriginString,
  type LoadedWorkflow,
  loadProviders,
  loadWorkspace,
  mountWorkflows,
  type ProviderContainer,
} from "@darrylondil/lorien-runtime"
import { attachAgentBroker, mountAgentBroker } from "@darrylondil/lorien-runtime/agent-broker"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import chokidar from "chokidar"
import type { Command } from "commander"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { generateServicesTypes } from "../generate-services-types.js"
import { findAvailablePort, parseStartingPort } from "../ports.js"
import { makeDebugIntegration } from "./debug-integration.js"
import { introspectWorkspace, invalidateSchemaCache } from "./introspect-workspace.js"
import { type NodeCasesRequest, type NodeCasesRun, runNodeCasesInWorker } from "./run-node-cases.js"
import {
  deleteWorkspaceItem,
  renameWorkspaceItem,
  WorkspaceItemError,
  workspaceItemUsage,
} from "./workspace-items.js"
import { collectWorkspaceTypes } from "./workspace-types.js"

// ── FileNode types (mirrors packages/ide/src/data/mock-files.ts) ─────────────
export type FileKind = "workflow" | "node"

export interface FileLeaf {
  type: "file"
  id: string
  name: string
  kind: FileKind
  path: string // relative path from workspace root (e.g., "workflows/users/create.workflow")
}

export interface FileFolder {
  type: "folder"
  id: string
  name: string
  children: FileNode[]
}

export type FileNode = FileLeaf | FileFolder

// ── Options ───────────────────────────────────────────────────────────────────

export interface IdeOptions {
  port?: number | string
  open?: boolean
  root?: string
}

export const DEFAULT_IDE_PORT = 8188

const WRITABLE_FILES_MESSAGE =
  "Only .workflow, .ts, .requests.json, .cases.json and lorien.environments(.local).json files may be written"

/**
 * The IDE may only write files it owns: workflows, node sources, saved request
 * collections and the environments files. Keeps a stray PUT from clobbering
 * package.json or lockfiles.
 */
export function isWritableWorkspaceFile(abs: string): boolean {
  const name = basename(abs)
  return (
    abs.endsWith(".workflow") ||
    abs.endsWith(".ts") ||
    abs.endsWith(".requests.json") ||
    abs.endsWith(".cases.json") ||
    name === "lorien.environments.json" ||
    name === "lorien.environments.local.json"
  )
}

export function registerIde(program: Command): void {
  program
    .command("ide")
    .description("Open the lorien IDE in your browser")
    .option("--port <number>", "starting port for the static server", String(DEFAULT_IDE_PORT))
    .option("--no-open", "do not open the browser automatically")
    .option("--root <path>", "workspace root (defaults to cwd)", process.cwd())
    .action(async (opts: IdeOptions) => {
      await runIde(opts)
    })
}

/**
 * Creates the Hono app for the IDE API routes.
 * Exported so tests can call `app.request(...)` without spinning up a real server.
 */
export interface IdeAppDeps {
  /** Runs node test cases; defaults to a fresh tsx subprocess per request. */
  runNodeCases?: (root: string, req: NodeCasesRequest) => Promise<NodeCasesRun>
}

export function createIdeApp(workspaceRoot: string, deps: IdeAppDeps = {}): Hono {
  const app = new Hono()

  // CORS for all routes — loopback-only so the IDE Vite dev server (e.g. :5173)
  // can call both /api/* and workflow endpoints without hitting CORS blocks.
  app.use(
    "*",
    cors({
      origin: (origin) => (isLoopbackOriginString(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["content-type", "authorization"],
    }),
  )

  // ── Workspace API routes ────────────────────────────────────────────────────

  app.get("/api/workspace/info", (c) => {
    return c.json({
      root: workspaceRoot,
      name: basename(workspaceRoot),
    })
  })

  app.get("/api/workspace/tree", async (c) => {
    try {
      const workflows = await buildFileTree(
        workspaceRoot,
        join(workspaceRoot, "workflows"),
        "wf",
        "workflow",
        "**/*.workflow",
      )
      const nodes = await buildFileTree(
        workspaceRoot,
        join(workspaceRoot, "nodes"),
        "n",
        "node",
        "**/*.ts",
      )
      return c.json({ workflows, nodes })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.get("/api/workspace/file", async (c) => {
    const rawPath = c.req.query("path")
    if (!rawPath) {
      return c.json({ error: "Missing ?path= query parameter" }, 400)
    }
    // Resolve and validate — must stay inside workspaceRoot
    const abs = resolve(workspaceRoot, rawPath)
    if (!abs.startsWith(workspaceRoot + sep) && abs !== workspaceRoot) {
      return c.json({ error: "Path traversal denied" }, 403)
    }
    try {
      const content = await readFile(abs, "utf-8")
      return c.json({ path: rawPath, content })
    } catch {
      return c.json({ error: "File not found" }, 404)
    }
  })

  app.put("/api/workspace/file", async (c) => {
    const createOnly = c.req.query("create") === "true"

    if (createOnly) {
      // Create-only mode: path comes from ?path= query param, body is raw text content
      const rawPath = c.req.query("path")
      if (!rawPath) {
        return c.json({ error: "Missing ?path= query parameter" }, 400)
      }
      const abs = resolve(workspaceRoot, rawPath)
      if (!abs.startsWith(workspaceRoot + sep) && abs !== workspaceRoot) {
        return c.json({ error: "Path traversal denied" }, 403)
      }
      if (!isWritableWorkspaceFile(abs)) {
        return c.json({ error: WRITABLE_FILES_MESSAGE }, 400)
      }
      // 409 if the file already exists
      try {
        await access(abs)
        return c.json({ error: "File already exists" }, 409)
      } catch {
        // File does not exist — proceed to write
      }
      const content = await c.req.text()
      try {
        await writeFile(abs, content, "utf-8")
        return c.json({ path: rawPath, bytes: content.length })
      } catch (e) {
        return c.json({ error: (e as Error).message }, 500)
      }
    }

    // Default mode: JSON body { path, content }
    const body = (await c.req.json().catch(() => null)) as {
      path?: string
      content?: string
    } | null
    if (!body || typeof body.path !== "string" || typeof body.content !== "string") {
      return c.json({ error: "Body must be { path: string, content: string }" }, 400)
    }
    const rawPath = body.path
    const abs = resolve(workspaceRoot, rawPath)
    if (!abs.startsWith(workspaceRoot + sep) && abs !== workspaceRoot) {
      return c.json({ error: "Path traversal denied" }, 403)
    }
    if (!isWritableWorkspaceFile(abs)) {
      return c.json({ error: WRITABLE_FILES_MESSAGE }, 400)
    }
    try {
      await writeFile(abs, body.content, "utf-8")
      return c.json({ path: rawPath, bytes: body.content.length })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.post("/api/workspace/folder", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      path?: string
    } | null
    if (!body || typeof body.path !== "string" || body.path.length === 0) {
      return c.json({ error: "Body must be { path: string }" }, 400)
    }
    const rawPath = body.path
    const abs = resolve(workspaceRoot, rawPath)
    if (!abs.startsWith(workspaceRoot + sep) && abs !== workspaceRoot) {
      return c.json({ error: "Path traversal denied" }, 403)
    }
    try {
      await mkdir(abs, { recursive: true })
      return c.json({ path: rawPath })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  // ── Rename / delete a workflow or node (with its requests or cases) ──────

  const itemError = (e: unknown) => {
    if (e instanceof WorkspaceItemError) return { body: { error: e.message }, status: e.status }
    return { body: { error: (e as Error).message }, status: 500 as const }
  }

  app.post("/api/workspace/rename", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { from?: unknown; to?: unknown } | null
    if (!body || typeof body.from !== "string" || typeof body.to !== "string") {
      return c.json({ error: "Body must be { from: string, to: string }" }, 400)
    }
    try {
      return c.json(await renameWorkspaceItem(resolve(workspaceRoot), body.from, body.to))
    } catch (e) {
      const { body: err, status } = itemError(e)
      return c.json(err, status)
    }
  })

  app.get("/api/workspace/usage", async (c) => {
    const rawPath = c.req.query("path")
    if (!rawPath) return c.json({ error: "Missing ?path= query parameter" }, 400)
    try {
      return c.json(await workspaceItemUsage(resolve(workspaceRoot), rawPath))
    } catch (e) {
      const { body: err, status } = itemError(e)
      return c.json(err, status)
    }
  })

  app.delete("/api/workspace/file", async (c) => {
    const rawPath = c.req.query("path")
    if (!rawPath) return c.json({ error: "Missing ?path= query parameter" }, 400)
    try {
      return c.json(await deleteWorkspaceItem(resolve(workspaceRoot), rawPath))
    } catch (e) {
      const { body: err, status } = itemError(e)
      return c.json(err, status)
    }
  })

  // ── Node test cases ────────────────────────────────────────────────────────

  app.post("/api/tests/nodes", async (c) => {
    const body = ((await c.req.json().catch(() => ({}))) ?? {}) as NodeCasesRequest
    const req: NodeCasesRequest = {}
    if (typeof body.filter === "string") req.filter = body.filter
    if (body.only && typeof body.only === "object") req.only = body.only
    try {
      const run = await (deps.runNodeCases ?? runNodeCasesInWorker)(workspaceRoot, req)
      return c.json(run, run.error ? 500 : 200)
    } catch (e) {
      return c.json({ files: [], logs: "", error: (e as Error).message }, 500)
    }
  })

  // ── Schemas (Zod -> JSON Schema for each node) ─────────────────────────────

  app.get("/api/workspace/schemas", async (c) => {
    try {
      const { schemas, warnings } = await introspectWorkspace(workspaceRoot)
      return c.json({ schemas, warnings })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  // ── Type declarations for the code editor ────────────────────────────────

  app.get("/api/workspace/types", async (c) => {
    try {
      return c.json(await collectWorkspaceTypes(workspaceRoot))
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  // ── Agent broker (REST half — WS upgrade attached after serve() in runIde) ──

  mountAgentBroker(app, { projectRoot: workspaceRoot })

  // ── SSE file-change events ─────────────────────────────────────────────────

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      const watchPaths = [join(workspaceRoot, "workflows"), join(workspaceRoot, "nodes")]
      const watcher = chokidar.watch(watchPaths, {
        ignored: /(^|[/\\])\../,
        ignoreInitial: true,
        persistent: true,
      })

      const emit = async (kind: "change" | "add" | "unlink", absPath: string) => {
        const rel = relative(workspaceRoot, absPath).replaceAll("\\", "/")
        // Invalidate the schema cache for any .ts node file change so the
        // next /api/workspace/schemas call re-runs the worker.
        if (absPath.endsWith(".ts")) {
          invalidateSchemaCache(absPath)
        }
        try {
          await stream.writeSSE({
            event: kind,
            data: JSON.stringify({ path: rel }),
          })
        } catch {
          // Client disconnected; will be cleaned up below
        }
      }

      watcher.on("change", (p) => {
        void emit("change", p)
      })
      watcher.on("add", (p) => {
        void emit("add", p)
      })
      watcher.on("unlink", (p) => {
        void emit("unlink", p)
      })

      // Periodic keep-alive so proxies don't close the connection
      const keepAlive = setInterval(() => {
        void stream.writeSSE({ event: "ping", data: "" })
      }, 15000)

      // Clean up on disconnect
      stream.onAbort(() => {
        clearInterval(keepAlive)
        void watcher.close()
      })

      // Hold the stream open until the client disconnects
      await new Promise<void>((resolve_) => {
        stream.onAbort(resolve_)
      })
    })
  })

  return app
}

/**
 * Assembles the Hono app for a workspace snapshot. Called once at startup and
 * again on every workflow hot-reload. Returns a fresh `Hono` with IDE API
 * routes + workflow handlers + static SPA serving mounted.
 */
function buildAppForWorkspace(params: {
  workspaceRoot: string
  ideDistRoot: string
  loadedWorkflows: LoadedWorkflow[]
  loadedNodes: Record<string, AnyNodeOrTrigger>
  loadedProviders: ProviderContainer
  debug: DebugIntegration
}): Hono {
  const app = createIdeApp(params.workspaceRoot)
  mountWorkflows(app, params.loadedWorkflows, {
    nodes: params.loadedNodes,
    providers: params.loadedProviders,
    debug: params.debug,
  })
  // Static SPA — must be inside the build helper so it survives hot-reload.
  app.use(
    "/*",
    serveStatic({
      root: params.ideDistRoot,
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
    }),
  )
  // SPA fallback for client-side routes
  app.get("*", serveStatic({ root: params.ideDistRoot, path: "index.html" }))
  return app
}

export async function runIde(opts: IdeOptions): Promise<{ port: number; root: string }> {
  const ideDistRoot = await resolveIdeDistRoot()
  const workspaceRoot = resolve(opts.root ?? process.cwd())
  const port = parseStartingPort(opts.port, DEFAULT_IDE_PORT)
  const availablePort = await findAvailablePort(port)
  if (availablePort !== port) {
    console.log(`lorien IDE: port ${port} is busy; using ${availablePort}.`)
  }

  // ── Register tsx so the IDE process can dynamic-import .ts node files ─────
  // The IDE is launched as plain `node ./dist/cli.js` — Node has no native .ts
  // support at this version, so `await import("foo.ts")` throws
  // `Unknown file extension`. tsx is already a workspace devDep for `tsx
  // src/server.ts`, so we resolve it from the user's node_modules.

  await registerTsxFromWorkspace(workspaceRoot)

  // ── Load workspace (workflows + nodes) for DebugSession ───────────────────

  const [ws, importResult] = await Promise.all([
    loadWorkspace(workspaceRoot),
    importNodes(workspaceRoot),
  ])
  const loadedWorkflows = ws.workflows
  if (importResult.errors.length > 0) {
    for (const e of importResult.errors) {
      console.error(`[lorien] ${e.path}: ${e.message}`)
    }
  }
  const loadedNodes = { ...importResult.nodes }

  // ── Load providers (mirrors startLorienServer) and type them for the editor ──

  const loadedProviders = await loadProviders(workspaceRoot)
  try {
    await loadedProviders.init()
  } catch (e) {
    console.error(`[lorien] ${(e as Error).message}`)
  }
  await generateServicesTypes(workspaceRoot).catch((e: unknown) => {
    console.error(`[lorien] generating provider types failed: ${(e as Error).message}`)
  })

  // ── DebugSession + console capture + DebugIntegration ────────────────────

  const debugSession = new DebugSession()

  installConsoleCapture(({ runId, level, message }) => {
    const startedAt = debugSession.getRunStartedAt(runId)
    if (startedAt === null) return
    debugSession.broadcast({
      type: "log",
      runId,
      level,
      message,
      offsetMs: Date.now() - startedAt,
    })
  })

  const debug: DebugIntegration = makeDebugIntegration(debugSession)

  // ── Build the Hono app for this workspace snapshot ────────────────────────

  let currentApp: Hono = buildAppForWorkspace({
    workspaceRoot,
    ideDistRoot,
    loadedWorkflows,
    loadedNodes,
    loadedProviders,
    debug,
  })

  // ── Hot-reload: watch <root>/workflows/**/*.workflow ──────────────────────
  // On any change, reload the workspace and atomically swap currentApp so
  // subsequent requests hit the fresh workflow. Paused runs are aborted
  // (their pause-promise rejects with AbortError; the handler's catch block
  // broadcasts run-error).

  const debounce = <F extends (...args: never[]) => void>(fn: F, ms: number): F => {
    let t: NodeJS.Timeout | null = null
    return ((...args: never[]) => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        t = null
        fn(...args)
      }, ms)
    }) as F
  }

  const reloadWorkspace = async (): Promise<void> => {
    try {
      const ws = await loadWorkspace(workspaceRoot)
      if (ws.errors.length > 0) {
        for (const e of ws.errors) console.error(`[lorien] ${e.path}: ${e.message}`)
      }
      debugSession.abortAllRuns()
      currentApp = buildAppForWorkspace({
        workspaceRoot,
        ideDistRoot,
        loadedWorkflows: ws.workflows,
        loadedNodes,
        loadedProviders,
        debug,
      })
      console.log(`lorien IDE: reloaded ${ws.workflows.length} workflow(s)`)
    } catch (err) {
      console.error(`lorien IDE: reload failed — ${(err as Error).message}`)
    }
  }

  const debouncedReload = debounce(reloadWorkspace, 100)

  const workflowWatcher = chokidar.watch(join(workspaceRoot, "workflows"), {
    ignoreInitial: true,
    persistent: true,
    usePolling: process.platform === "win32",
    interval: 50,
  })
  workflowWatcher.on("all", (_event, filePath) => {
    if (typeof filePath === "string" && filePath.endsWith(".workflow")) {
      debouncedReload()
    }
  })
  const watcherReady = new Promise<void>((r) => workflowWatcher.once("ready", r))

  return new Promise((resolveStarted) => {
    const dispatcher: typeof currentApp.fetch = (req, env, ctx) => currentApp.fetch(req, env, ctx)
    const server = serve({ fetch: dispatcher, port: availablePort }, ({ port: actualPort }) => {
      const url = `http://localhost:${actualPort}`
      console.log(`lorien IDE running at ${url}`)
      console.log(`  workspace: ${workspaceRoot}`)
      if (opts.open !== false) {
        openBrowser(url).catch((err: Error) => {
          console.error(`Could not open browser automatically: ${err.message}`)
          console.error(`Open ${url} manually.`)
        })
      }
      // Wait for the workflow watcher to be ready before resolving, so that
      // callers (e.g. tests) can safely write files and expect hot-reload to fire.
      void watcherReady.then(() => resolveStarted({ port: actualPort, root: ideDistRoot }))
    })
    // @hono/node-server's serve() returns ServerType (HTTP1 | HTTP2); both brokers
    // only use the subset of the http.Server API (the 'upgrade' event), so the cast
    // is safe in practice.
    const httpServer = server as unknown as HttpServer
    attachAgentBroker({ app: currentApp, server: httpServer, projectRoot: workspaceRoot })
    attachDebugWebSocket({ app: currentApp, server: httpServer, session: debugSession })
  })
}

// ── File-tree builder ─────────────────────────────────────────────────────────

/**
 * Recursively builds a FileFolder tree for `dir`, assigning stable IDs
 * derived from the relative path from `workspaceRoot`.
 */
async function buildFileTree(
  workspaceRoot: string,
  dir: string,
  idPrefix: string,
  kind: FileKind,
  _pattern: string,
): Promise<FileFolder> {
  const name = basename(dir)

  const buildNode = async (absDir: string, prefix: string): Promise<FileNode[]> => {
    let entries: { name: string; isDirectory: boolean }[]
    try {
      const raw = await readdir(absDir, { withFileTypes: true })
      entries = raw.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch {
      return []
    }

    const result: FileNode[] = []
    for (const entry of entries) {
      const absPath = join(absDir, entry.name)
      const relPath = relative(workspaceRoot, absPath)
      // Stable id: prefix + relative path with path separators replaced
      const id = `${prefix}-${relPath.replace(/[/\\]/g, "-").replace(/\./g, "_")}`

      if (entry.isDirectory) {
        const children = await buildNode(absPath, prefix)
        result.push({
          type: "folder",
          id,
          name: entry.name,
          children,
        })
      } else {
        // Filter by kind
        if (kind === "workflow" && !entry.name.endsWith(".workflow")) continue
        if (kind === "node" && !entry.name.endsWith(".ts")) continue
        result.push({
          type: "file",
          id,
          name: entry.name,
          kind,
          path: relPath.replace(/\\/g, "/"),
        })
      }
    }
    return result
  }

  const children = await buildNode(dir, idPrefix)
  const relDir = relative(workspaceRoot, dir)
  const folderId = `${idPrefix}-${relDir.replace(/[/\\]/g, "-") || "root"}`

  return {
    type: "folder",
    id: folderId,
    name,
    children,
  }
}

async function resolveIdeDistRoot(): Promise<string> {
  // Resolve @darrylondil/lorien-ide's package root, then return its dist/
  const require_ = createRequire(import.meta.url)
  try {
    const pkgJsonPath = require_.resolve("@darrylondil/lorien-ide/package.json")
    const pkgRoot = dirname(pkgJsonPath)
    const distPath = join(pkgRoot, "dist")
    if (!(await dirExists(distPath))) {
      throw new Error(
        `@darrylondil/lorien-ide's dist/ folder is missing at ${distPath}. Run \`pnpm --filter @darrylondil/lorien-ide build\` first.`,
      )
    }
    return distPath
  } catch (e) {
    throw new Error(
      `Could not locate @darrylondil/lorien-ide. Ensure it's installed as a dependency. Original error: ${(e as Error).message}`,
    )
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform
  let command: string
  let args: string[]
  if (platform === "darwin") {
    command = "open"
    args = [url]
  } else if (platform === "win32") {
    command = "cmd"
    args = ["/c", "start", "", url]
  } else {
    command = "xdg-open"
    args = [url]
  }
  return new Promise((resolveSpawn, rejectSpawn) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true })
    child.on("error", rejectSpawn)
    child.unref()
    setTimeout(() => resolveSpawn(), 100)
  })
}

export async function registerTsxFromWorkspace(root: string): Promise<void> {
  try {
    const anchor = pathToFileURL(join(root, "package.json")).href
    const req = createRequire(anchor)
    const apiPath = req.resolve("tsx/esm/api")
    const mod = (await import(pathToFileURL(apiPath).href)) as {
      register?: () => unknown
    }
    if (typeof mod.register === "function") {
      mod.register()
    }
  } catch {
    console.warn(
      "[lorien] tsx not found in workspace — .ts node files may fail to load. Install with `pnpm add -D tsx` (or your package manager's equivalent).",
    )
  }
}
