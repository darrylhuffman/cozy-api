import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Hono } from "hono";
import type { LifecycleEmitter } from "../exec/lifecycle.js";
import { createServiceResolver } from "../services/resolve.js";
import type { AnyNodeOrTrigger, Services, WorkflowConfig } from "../types.js";
import { importNodes } from "./import-nodes.js";
import { loadWorkspace } from "./load.js";
import { mountWorkflows } from "./server.js";

export interface StartServerOptions {
  /** Project root. Defaults to process.cwd(). */
  root?: string;
  /** Service overrides applied on top of lorien.config.ts. Useful for tests. */
  services?: Partial<Services>;
  /** Node registry. (Auto-discovery from /nodes lands in Task 2.) */
  nodes?: Record<string, AnyNodeOrTrigger>;
  /** Optional lifecycle subscriber. */
  lifecycle?: LifecycleEmitter;
  /** Default true; if false, errors throw instead of being logged + skipped. */
  lenient?: boolean;
}

export async function startLorienServer(
  opts: StartServerOptions = {},
): Promise<Hono> {
  const root = resolve(opts.root ?? process.cwd());
  const lenient = opts.lenient ?? true;

  // 1. Load lorien.config.ts if present
  const services = await loadServices(root, opts.services, lenient);

  // 2. Load workflows
  const ws = await loadWorkspace(root);
  if (ws.errors.length > 0) {
    for (const e of ws.errors)
      console.error(`[lorien] ${e.path}: ${e.message}`);
    if (!lenient) {
      throw new Error(`Failed to load workflows: ${ws.errors.length} error(s)`);
    }
  }

  // 3. Auto-import nodes from <root>/nodes/**
  const importResult = await importNodes(root);
  if (importResult.errors.length > 0) {
    for (const e of importResult.errors) {
      console.error(`[lorien] ${e.path}: ${e.message}`);
    }
    if (!lenient) {
      throw new Error(
        `Failed to import nodes: ${importResult.errors.length} error(s)`,
      );
    }
  }
  const nodes = { ...importResult.nodes, ...(opts.nodes ?? {}) };

  // 4. Build Hono app + mount
  const app = new Hono();
  mountWorkflows(app, ws.workflows, {
    nodes,
    services,
    ...(opts.lifecycle ? { lifecycle: opts.lifecycle } : {}),
  });
  return app;
}

async function loadServices(
  root: string,
  overrides: Partial<Services> | undefined,
  lenient: boolean,
): Promise<Services> {
  const configPath = join(root, "lorien.config.ts");
  let configServices: WorkflowConfig["services"] = {};

  if (await fileExists(configPath)) {
    try {
      const mod = (await import(pathToFileURL(configPath).href)) as {
        default?: WorkflowConfig;
      };
      if (mod.default?.services) {
        configServices = mod.default.services;
      }
    } catch (e) {
      const msg = `[lorien] failed to load lorien.config.ts: ${(e as Error).message}`;
      console.error(msg);
      if (!lenient) throw e;
    }
  } else {
    console.warn(
      `[lorien] no lorien.config.ts at ${root} — services will be empty`,
    );
  }

  const resolver = createServiceResolver(configServices);
  const resolved = await resolver.resolve({
    requestId: `boot-${Math.random().toString(36).slice(2)}`,
    timestamp: Date.now(),
  });

  // Apply overrides
  const services = { ...resolved, ...(overrides ?? {}) } as Services;
  return services;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
