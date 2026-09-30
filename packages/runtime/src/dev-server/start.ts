import { resolve } from "node:path"
import { Hono } from "hono"
import type { LifecycleEmitter } from "../exec/lifecycle.js"
import { importMiddleware } from "../middleware/load.js"
import { loadProviders } from "../providers/load.js"
import type { AnyNodeOrTrigger, Services } from "../types.js"
import { importNodes } from "./import-nodes.js"
import { loadWorkspace } from "./load.js"
import { answerUnmatchedWithJson } from "./not-found.js"
import { mountWorkflows } from "./server.js"

export interface StartServerOptions {
  /** Project root. Defaults to process.cwd(). */
  root?: string
  /** Values that replace providers of the same name. Useful for tests. */
  services?: Partial<Services>
  /** Node registry. (Auto-discovery from /nodes lands in Task 2.) */
  nodes?: Record<string, AnyNodeOrTrigger>
  /** Optional lifecycle subscriber. */
  lifecycle?: LifecycleEmitter
  /**
   * Apply node mocks and record traces for request tests (`x-lorien-test`).
   * `lorien test` turns this on; leave it off for a deployed server.
   */
  testHooks?: boolean
  /** Default true; if false, errors throw instead of being logged + skipped. */
  lenient?: boolean
}

export async function startLorienServer(opts: StartServerOptions = {}): Promise<Hono> {
  const root = resolve(opts.root ?? process.cwd())
  const lenient = opts.lenient ?? true

  // 1. Load providers/*.ts (and legacy lorien.config.ts services); create singletons.
  const providers = await loadProviders(root, {
    strict: !lenient,
    ...(opts.services ? { overrides: opts.services as Record<string, unknown> } : {}),
  })
  await providers.init()

  // 2. Load workflows
  const ws = await loadWorkspace(root)
  if (ws.errors.length > 0) {
    for (const e of ws.errors) console.error(`[lorien] ${e.path}: ${e.message}`)
    if (!lenient) {
      throw new Error(`Failed to load workflows: ${ws.errors.length} error(s)`)
    }
  }

  // 3. Auto-import nodes from <root>/nodes/**
  const importResult = await importNodes(root)
  if (importResult.errors.length > 0) {
    for (const e of importResult.errors) {
      console.error(`[lorien] ${e.path}: ${e.message}`)
    }
    if (!lenient) {
      throw new Error(`Failed to import nodes: ${importResult.errors.length} error(s)`)
    }
  }
  const nodes = { ...importResult.nodes, ...(opts.nodes ?? {}) }

  // 4. Import workflows/**/_middleware.ts
  const middleware = await importMiddleware(root)
  for (const e of middleware.errors) console.error(`[lorien] ${e.path}: ${e.message}`)
  if (!lenient && middleware.errors.length > 0) {
    throw new Error(`Failed to import middleware: ${middleware.errors.length} error(s)`)
  }

  // 5. Build Hono app + mount
  const app = new Hono()
  mountWorkflows(app, ws.workflows, {
    nodes,
    providers,
    middleware: middleware.byDir,
    ...(opts.lifecycle ? { lifecycle: opts.lifecycle } : {}),
    ...(opts.testHooks ? { testHooks: true } : {}),
  })
  answerUnmatchedWithJson(app)
  return app
}
