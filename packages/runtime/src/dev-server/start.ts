import { stat } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Hono } from "hono"
import type { LifecycleEmitter } from "../exec/lifecycle.js"
import { createServiceResolver } from "../services/resolve.js"
import type { AnyNodeOrTrigger, Services, WorkflowConfig } from "../types.js"
import { loadWorkspace } from "./load.js"
import { mountWorkflows } from "./server.js"

export interface StartServerOptions {
  /** Project root. Defaults to process.cwd(). */
  root?: string
  /** Service overrides applied on top of cozy.config.ts. Useful for tests. */
  services?: Partial<Services>
  /** Node registry. (Auto-discovery from /nodes lands in Task 2.) */
  nodes?: Record<string, AnyNodeOrTrigger>
  /** Optional lifecycle subscriber. */
  lifecycle?: LifecycleEmitter
  /** Default true; if false, errors throw instead of being logged + skipped. */
  lenient?: boolean
}

export async function startCozyServer(opts: StartServerOptions = {}): Promise<Hono> {
  const root = resolve(opts.root ?? process.cwd())
  const lenient = opts.lenient ?? true

  // 1. Load cozy.config.ts if present
  const services = await loadServices(root, opts.services, lenient)

  // 2. Load workflows
  const ws = await loadWorkspace(root)
  if (ws.errors.length > 0) {
    for (const e of ws.errors) console.error(`[cozy] ${e.path}: ${e.message}`)
    if (!lenient) {
      throw new Error(`Failed to load workflows: ${ws.errors.length} error(s)`)
    }
  }

  // 3. Build Hono app + mount
  const app = new Hono()
  mountWorkflows(app, ws.workflows, {
    nodes: opts.nodes ?? {},
    services,
    ...(opts.lifecycle ? { lifecycle: opts.lifecycle } : {}),
  })
  return app
}

async function loadServices(
  root: string,
  overrides: Partial<Services> | undefined,
  lenient: boolean,
): Promise<Services> {
  const configPath = join(root, "cozy.config.ts")
  let configServices: WorkflowConfig["services"] = {}

  if (await fileExists(configPath)) {
    try {
      const mod = (await import(pathToFileURL(configPath).href)) as { default?: WorkflowConfig }
      if (mod.default?.services) {
        configServices = mod.default.services
      }
    } catch (e) {
      const msg = `[cozy] failed to load cozy.config.ts: ${(e as Error).message}`
      console.error(msg)
      if (!lenient) throw e
    }
  } else {
    console.warn(`[cozy] no cozy.config.ts at ${root} — services will be empty`)
  }

  const resolver = createServiceResolver(configServices)
  const resolved = await resolver.resolve({
    requestId: `boot-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
  })

  // Apply overrides
  const services = { ...resolved, ...(overrides ?? {}) } as Services
  return services
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}
