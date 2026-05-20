import { spawn } from "node:child_process"
import { readFile, readdir, stat } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import type { Command } from "commander"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { findAvailablePort, parseStartingPort } from "../ports.js"

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

export async function runIde(opts: IdeOptions): Promise<{ port: number; root: string }> {
  const ideDistRoot = await resolveIdeDistRoot()
  const workspaceRoot = resolve(opts.root ?? process.cwd())
  const port = parseStartingPort(opts.port, DEFAULT_IDE_PORT)
  const availablePort = await findAvailablePort(port)
  if (availablePort !== port) {
    console.log(`lorien IDE: port ${port} is busy; using ${availablePort}.`)
  }

  const app = new Hono()

  // CORS for API routes — needed when Vite dev (5173) talks to this server (3737)
  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        if (!origin) return null
        try {
          const { hostname } = new URL(origin)
          if (hostname === "localhost" || hostname === "127.0.0.1") return origin
        } catch {
          // invalid origin — deny
        }
        return null
      },
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
    serve({ fetch: app.fetch, port: availablePort }, ({ port: actualPort }) => {
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
