import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import {
  COLLECTION_SUFFIX,
  ENVIRONMENTS_FILE,
  type EnvironmentsFile,
  type FetchLike,
  LOCAL_ENVIRONMENTS_FILE,
  mergeEnvironments,
  parseEnvironments,
  parseRequestCollection,
  type RequestCollection,
  type RequestRunResult,
  runRequests,
} from "../requests/index.js"

export interface CollectionFile {
  /** Workspace-relative, forward slashes: `workflows/users/create.requests.json`. */
  path: string
  collection?: RequestCollection
  /** Set when the file could not be parsed. */
  error?: string
}

export interface CollectionRunResult {
  path: string
  error?: string
  results: RequestRunResult[]
}

export interface RunRequestCollectionsOptions {
  root: string
  /** Environment name from lorien.environments.json. Defaults to its `default`. */
  env?: string
  /** Send real HTTP to this URL instead of calling `app` in-process. */
  baseUrl?: string
  /**
   * Something with a WHATWG `fetch(Request)` — typically the Hono app from
   * `startLorienServer({ root })`. Used when no baseUrl is given.
   */
  app?: { fetch: (req: Request) => Response | Promise<Response> }
  /** Only run collections whose path contains this string. */
  filter?: string
  onResult?: (file: string, result: RequestRunResult) => void
}

const IN_PROCESS_BASE = "http://lorien.test"

export async function findCollectionFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else if (e.name.endsWith(COLLECTION_SUFFIX))
        out.push(relative(root, abs).split(sep).join("/"))
    }
  }
  await walk(join(root, "workflows"))
  return out.sort()
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8")
  } catch {
    return null
  }
}

export async function loadEnvironments(root: string): Promise<EnvironmentsFile> {
  const shared = await readOptional(join(root, ENVIRONMENTS_FILE))
  const local = await readOptional(join(root, LOCAL_ENVIRONMENTS_FILE))
  return mergeEnvironments(
    shared === null ? null : parseEnvironments(shared, ENVIRONMENTS_FILE),
    local === null ? null : parseEnvironments(local, LOCAL_ENVIRONMENTS_FILE),
  )
}

export async function loadCollectionFiles(root: string): Promise<CollectionFile[]> {
  const files = await findCollectionFiles(root)
  return Promise.all(
    files.map(async (path) => {
      try {
        const text = await readFile(join(root, path), "utf-8")
        return { path, collection: parseRequestCollection(text, path) }
      } catch (e) {
        return { path, error: (e as Error).message }
      }
    }),
  )
}

/**
 * Runs every `workflows/**\/*.requests.json` in a workspace — the same saved
 * requests the IDE's Run tab edits. Use from `lorien test`, or from Vitest:
 *
 * ```ts
 * const app = await startLorienServer({ root, testHooks: true })
 * const runs = await runRequestCollections({ root, app })
 * for (const run of runs) for (const r of run.results)
 *   test(`${run.path} › ${r.name}`, () => expect(failureSummary(r)).toEqual([]))
 * ```
 */
export async function runRequestCollections(
  opts: RunRequestCollectionsOptions,
): Promise<CollectionRunResult[]> {
  const envs = await loadEnvironments(opts.root)
  const envName = opts.env ?? envs.default
  if (opts.env && !envs.environments[opts.env]) {
    const known = Object.keys(envs.environments)
    throw new Error(
      `Unknown environment "${opts.env}"${known.length ? ` (known: ${known.join(", ")})` : ` — no ${ENVIRONMENTS_FILE} found`}`,
    )
  }
  const vars = { ...(envName ? envs.environments[envName] : {}) }

  let fetchImpl: FetchLike | undefined
  let baseUrl = opts.baseUrl
  if (!baseUrl) {
    if (!opts.app) throw new Error("runRequestCollections needs either baseUrl or app")
    const app = opts.app
    baseUrl = IN_PROCESS_BASE
    // In-process runs always hit the app, whatever baseUrl the environment names.
    delete vars.baseUrl
    fetchImpl = async (input, init) => app.fetch(new Request(input, init))
  }

  const files = (await loadCollectionFiles(opts.root)).filter(
    (f) => !opts.filter || f.path.includes(opts.filter),
  )
  const out: CollectionRunResult[] = []
  for (const file of files) {
    if (!file.collection) {
      out.push({ path: file.path, error: file.error ?? "unreadable", results: [] })
      continue
    }
    const results = await runRequests(file.collection.requests, {
      baseUrl,
      vars,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      onResult: (r) => opts.onResult?.(file.path, r),
    })
    out.push({ path: file.path, results })
  }
  return out
}

/** Human-readable reasons a request failed; empty when it passed. */
export function failureSummary(r: RequestRunResult): string[] {
  if (r.error) return [r.error]
  const out = r.assertions.filter((a) => !a.pass).map((a) => a.message)
  if (out.length === 0 && !r.passed && r.response) out.push(`status ${r.response.status}`)
  if (r.missingVariables.length > 0)
    out.push(`undefined variables: ${r.missingVariables.join(", ")}`)
  return r.passed ? [] : out
}
