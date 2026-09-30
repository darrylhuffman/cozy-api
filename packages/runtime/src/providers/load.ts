import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { ServiceValue, WorkflowConfig } from "../types.js"
import {
  type CreateProviderContainerOptions,
  createProviderContainer,
  type ProviderContainer,
} from "./container.js"
import { type AnyProvider, isProvider } from "./define-provider.js"

export interface ProviderFile {
  /** The name nodes read it by: `http-client.ts` becomes `httpClient`. */
  name: string
  /** Project-relative path, e.g. `providers/db.ts`. */
  path: string
}

const PROVIDER_FILE = /^([A-Za-z][\w-]*)\.(ts|mts|js|mjs)$/
const SKIP = /\.(test|spec|test-d)\.[mc]?[jt]s$|\.d\.[mc]?ts$/

/**
 * Lists `providers/*.ts`. Only files directly inside `providers/` are
 * providers; subfolders (`providers/db/`) hold code private to one provider.
 */
export async function findProviderFiles(root: string): Promise<ProviderFile[]> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await readdir(join(root, "providers"), { withFileTypes: true })
  } catch {
    return []
  }
  const out: ProviderFile[] = []
  for (const e of entries) {
    if (!e.isFile() || SKIP.test(e.name)) continue
    const m = PROVIDER_FILE.exec(e.name)
    if (!m) continue
    out.push({ name: providerName(m[1]!), path: `providers/${e.name}` })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** `http-client` → `httpClient`. */
export function providerName(fileBase: string): string {
  return fileBase.replace(/[-_]+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase())
}

export interface ImportProvidersResult {
  providers: Record<string, AnyProvider>
  errors: Array<{ path: string; message: string }>
}

export async function importProviders(root: string): Promise<ImportProvidersResult> {
  const providers: Record<string, AnyProvider> = {}
  const errors: ImportProvidersResult["errors"] = []
  for (const f of await findProviderFiles(root)) {
    try {
      const mod = (await import(pathToFileURL(join(root, f.path)).href)) as { default?: unknown }
      if (!isProvider(mod.default)) {
        errors.push({ path: f.path, message: "default export is not a defineProvider(...)" })
        continue
      }
      if (providers[f.name]) {
        errors.push({ path: f.path, message: `another file already provides "${f.name}"` })
        continue
      }
      providers[f.name] = mod.default
    } catch (e) {
      errors.push({ path: f.path, message: (e as Error).message })
    }
  }
  return { providers, errors }
}

/** Services still registered in `lorien.config.ts` (the pre-providers way). */
export async function importLegacyServices(
  root: string,
): Promise<Record<string, ServiceValue<unknown>>> {
  const configPath = join(root, "lorien.config.ts")
  try {
    await stat(configPath)
  } catch {
    return {}
  }
  const mod = (await import(pathToFileURL(configPath).href)) as { default?: WorkflowConfig }
  return mod.default?.services ?? {}
}

export interface LoadProvidersOptions extends Omit<CreateProviderContainerOptions, "legacy"> {
  /** Throw on a provider that fails to import instead of logging it. Default false. */
  strict?: boolean
}

/**
 * Loads `providers/*.ts` and any `lorien.config.ts` services into one
 * container, the way the dev server, IDE and test runner all see them.
 */
export async function loadProviders(
  root: string,
  opts: LoadProvidersOptions = {},
): Promise<ProviderContainer> {
  const { providers, errors } = await importProviders(root)
  for (const e of errors) console.error(`[lorien] ${e.path}: ${e.message}`)
  if (opts.strict && errors.length > 0) {
    throw new Error(`Failed to load providers: ${errors.length} error(s)`)
  }

  let legacy: Record<string, ServiceValue<unknown>> = {}
  try {
    legacy = await importLegacyServices(root)
  } catch (e) {
    console.error(`[lorien] failed to load lorien.config.ts: ${(e as Error).message}`)
    if (opts.strict) throw e
  }
  if (Object.keys(legacy).length > 0) {
    console.warn(
      `[lorien] services in lorien.config.ts are deprecated; move each to providers/<name>.ts ` +
        `(${Object.keys(legacy).join(", ")})`,
    )
  }

  return createProviderContainer(providers, { ...opts, legacy })
}
