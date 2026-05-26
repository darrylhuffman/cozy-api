import { spawn } from "node:child_process"
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import type { Server as HttpServer } from "node:http"
import { createRequire } from "node:module"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import {
  attachAgentBroker,
  mountAgentBroker,
} from "@darrylondil/lorien-runtime/agent-broker"
import {
  attachDebugWebSocket,
  createServiceResolver,
  DebugSession,
  importNodes,
  installConsoleCapture,
  isLoopbackOriginString,
  LifecycleEmitter,
  loadWorkspace,
  mountWorkflows,
  type DebugIntegration,
  type Services,
} from "@darrylondil/lorien-runtime"
import chokidar from "chokidar"
import type { Command } from "commander"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { findAvailablePort, parseStartingPort } from "../ports.js"
import { introspectWorkspace, invalidateSchemaCache } from "./introspect-workspace.js"

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
export function createIdeApp(workspaceRoot: string): Hono {
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
      if (!abs.endsWith(".workflow") && !abs.endsWith(".ts")) {
        return c.json({ error: "Only .workflow and .ts files may be written" }, 400)
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
    // Only allow writes to .workflow JSON and .ts files (whitelist)
    if (!abs.endsWith(".workflow") && !abs.endsWith(".ts")) {
      return c.json({ error: "Only .workflow and .ts files may be written" }, 400)
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

  // ── Schemas (Zod -> JSON Schema for each node) ─────────────────────────────

  app.get("/api/workspace/schemas", async (c) => {
    try {
      const { schemas, warnings } = await introspectWorkspace(workspaceRoot)
      return c.json({ schemas, warnings })
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

export async function runIde(opts: IdeOptions): Promise<{ port: number; root: string }> {
  const ideDistRoot = await resolveIdeDistRoot()
  const workspaceRoot = resolve(opts.root ?? process.cwd())
  const port = parseStartingPort(opts.port, DEFAULT_IDE_PORT)
  const availablePort = await findAvailablePort(port)
  if (availablePort !== port) {
    console.log(`lorien IDE: port ${port} is busy; using ${availablePort}.`)
  }

  const app = createIdeApp(workspaceRoot)

  // ── Load workspace (workflows + nodes) for DebugSession ───────────────────

  const [ws, importResult] = await Promise.all([
    loadWorkspace(workspaceRoot),
    importNodes(workspaceRoot),
  ])
  const loadedWorkflows = ws.workflows
  const loadedNodes = { ...importResult.nodes }

  // ── Load services from lorien.config.ts (mirrors startLorienServer) ───────

  const loadedServices = await (async () => {
    const configPath = join(workspaceRoot, "lorien.config.ts")
    let configServices: Record<string, unknown> = {}
    try {
      await stat(configPath)
      try {
        const mod = (await import(pathToFileURL(configPath).href)) as {
          default?: { services?: Record<string, unknown> }
        }
        if (mod.default?.services) {
          configServices = mod.default.services
        }
      } catch {
        // Config failed to load — proceed with empty services
      }
    } catch {
      // No lorien.config.ts — services will be empty
    }
    const resolver = createServiceResolver(configServices)
    const resolved = await resolver.resolve({ requestId: `ide-boot-${Math.random().toString(36).slice(2)}`, timestamp: Date.now() })
    return resolved as Services
  })()

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

  const debug: DebugIntegration = {
    newRunId: () => `r-${Math.random().toString(36).slice(2, 10)}`,
    buildRun: (runId, workflowPath) => {
      const startedAt = Date.now()
      const lifecycle = new LifecycleEmitter()
      for (const t of [
        "before-node",
        "after-node",
        "edge-fired",
        "error",
        "complete",
      ] as const) {
        lifecycle.on(t, (ev) => {
          const wireEvent =
            ev.type === "error"
              ? {
                  type: "error" as const,
                  nodeId: ev.nodeId,
                  error: {
                    message: ev.error.message,
                    ...(ev.error.stack !== undefined ? { stack: ev.error.stack } : {}),
                  },
                }
              : ev
          debugSession.broadcast({
            type: "event",
            runId,
            event: wireEvent as never,
            offsetMs: Date.now() - startedAt,
          })
        })
      }
      const { onBeforeNode, onAfterNode } = debugSession.registerRun(
        workflowPath,
        runId,
        startedAt,
      )
      return { lifecycle, onBeforeNode, onAfterNode }
    },
    onResult: (runId, result, totalMs) => {
      debugSession.broadcast({
        type: "run-complete",
        runId,
        status: result.status,
        body: result.body,
        totalMs,
      })
      debugSession.unregisterRun(runId)
    },
    onError: (runId, err, totalMs) => {
      const message = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      const nodeId =
        err && typeof err === "object" && "nodeId" in err
          ? ((err as { nodeId: unknown }).nodeId as string | undefined)
          : undefined
      debugSession.broadcast({
        type: "run-error",
        runId,
        ...(nodeId !== undefined ? { nodeId } : {}),
        message,
        ...(stack !== undefined ? { stack } : {}),
      })
      debugSession.unregisterRun(runId)
      void totalMs
    },
  }

  // ── Mount workflow HTTP endpoints ─────────────────────────────────────────

  mountWorkflows(app, loadedWorkflows, {
    nodes: loadedNodes,
    services: loadedServices,
    debug,
  })

  // ── Static SPA ─────────────────────────────────────────────────────────────

  app.use(
    "/*",
    serveStatic({
      root: ideDistRoot,
      rewriteRequestPath: (path) => (path === "/" ? "/index.html" : path),
    }),
  )

  // SPA fallback for client-side routes
  app.get("*", serveStatic({ root: ideDistRoot, path: "index.html" }))

  return new Promise((resolveStarted) => {
    const server = serve({ fetch: app.fetch, port: availablePort }, ({ port: actualPort }) => {
      const url = `http://localhost:${actualPort}`
      console.log(`lorien IDE running at ${url}`)
      console.log(`  workspace: ${workspaceRoot}`)
      if (opts.open !== false) {
        openBrowser(url).catch((err: Error) => {
          console.error(`Could not open browser automatically: ${err.message}`)
          console.error(`Open ${url} manually.`)
        })
      }
      resolveStarted({ port: actualPort, root: ideDistRoot })
    })
    // @hono/node-server's serve() returns ServerType (HTTP1 | HTTP2); both brokers
    // only use the subset of the http.Server API (the 'upgrade' event), so the cast
    // is safe in practice.
    const httpServer = server as unknown as HttpServer
    attachAgentBroker({ app, server: httpServer, projectRoot: workspaceRoot })
    attachDebugWebSocket({ app, server: httpServer, session: debugSession })
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
