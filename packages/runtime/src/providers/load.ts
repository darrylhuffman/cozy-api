import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { ServiceValue, WorkflowConfig } from "../types.js"
import {
  type CreateProviderContainerOptions,
  createProviderContainer,
  type ProviderContainer,
} from "./container.js"
import { type AnyProvider, isProvider, selectorProblem } from "./define-provider.js"

export interface ProviderFile {
  /** Its `selector`: the name nodes read it by. */
  name: string
  /** Project-relative path, e.g. `providers/db.ts` or `providers/aws/s3.ts`. */
  path: string
}

export interface ScanProvidersResult {
  files: ProviderFile[]
  errors: Array<{ path: string; message: string }>
}

const SOURCE_FILE = /\.(ts|mts|js|mjs)$/
const SKIP = /\.(test|spec|test-d)\.[mc]?[jt]s$|\.d\.[mc]?ts$/
const DEFINES_PROVIDER = /\bdefineProvider\s*\(/
const SELECTOR_LITERAL = /\bselector\s*:\s*(["'`])([^"'`\n]*)\1/

/**
 * Finds every provider under `providers/`, in any folder: a file that calls
 * `defineProvider(...)`. Each is named by its `selector`, read from the source
 * without importing it, so helper files next to a provider never run.
 */
export async function scanProviderFiles(root: string): Promise<ScanProvidersResult> {
  const files: ProviderFile[] = []
  const errors: ScanProvidersResult["errors"] = []
  const bySelector = new Map<string, string>()
  for (const path of await walk(root, "providers")) {
    let source: string
    try {
      source = await readFile(join(root, path), "utf-8")
    } catch {
      continue
    }
    if (!DEFINES_PROVIDER.test(source)) continue
    const selector = SELECTOR_LITERAL.exec(source)?.[2]
    if (selector === undefined) {
      errors.push({
        path,
        message: 'defineProvider needs a selector written as a string, e.g. selector: "db"',
      })
      continue
    }
    const problem = selectorProblem(selector)
    if (problem) {
      errors.push({ path, message: problem })
      continue
    }
    const taken = bySelector.get(selector)
    if (taken) {
      errors.push({ path, message: `selector "${selector}" is already used by ${taken}` })
      continue
    }
    bySelector.set(selector, path)
    files.push({ name: selector, path })
  }
  return { files, errors }
}

/** The providers `scanProviderFiles` finds, without its errors. */
export async function findProviderFiles(root: string): Promise<ProviderFile[]> {
  return (await scanProviderFiles(root)).files
}

/** Project-relative source files under `dir`, sorted, tests and typings skipped. */
async function walk(root: string, dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const e of entries) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) out.push(...(await walk(root, rel)))
    } else if (e.isFile() && SOURCE_FILE.test(e.name) && !SKIP.test(e.name)) {
      out.push(rel)
    }
  }
  return out.sort()
}

export interface ImportProvidersResult {
  providers: Record<string, AnyProvider>
  errors: Array<{ path: string; message: string }>
}

export async function importProviders(root: string): Promise<ImportProvidersResult> {
  const providers: Record<string, AnyProvider> = {}
  const scan = await scanProviderFiles(root)
  const errors: ImportProvidersResult["errors"] = [...scan.errors]
  for (const f of scan.files) {
    try {
      const mod = (await import(pathToFileURL(join(root, f.path)).href)) as { default?: unknown }
      if (!isProvider(mod.default)) {
        errors.push({ path: f.path, message: "default export is not a defineProvider(...)" })
        continue
      }
      if (mod.default.selector !== f.name) {
        errors.push({
          path: f.path,
          message: `selector must be the string "${f.name}" itself, not built at runtime`,
        })
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
      `[lorien] services in lorien.config.ts are deprecated; move each to a defineProvider in providers/ ` +
        `(${Object.keys(legacy).join(", ")})`,
    )
  }

  return createProviderContainer(providers, { ...opts, legacy })
}
