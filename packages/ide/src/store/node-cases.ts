import {
  casesPathFor,
  type NodeCase,
  type NodeCaseFile,
  type NodeCaseResult,
  parseCaseFile,
  serializeCaseFile,
} from "@darrylondil/lorien-runtime/cases"
import { create } from "zustand"
import { ApiError, fetchFile, runNodeTests, saveFile } from "@/lib/api"

export interface CaseFileEntry {
  /** `nodes/users/save-user.cases.json` */
  path: string
  file: NodeCaseFile
  loaded: boolean
  error: string | null
  saving: boolean
}

interface State {
  /** Keyed by node file, e.g. `nodes/users/save-user.ts`. */
  byNode: Record<string, CaseFileEntry>
  /** Keyed by `${casesPath}#${caseId}`. */
  results: Record<string, NodeCaseResult>
  /** Cases files currently running. */
  running: Record<string, boolean>
  /** Output of the last run: node logs and a worker-level error. */
  lastLogs: string
  runError: string | null
  load(nodeFile: string): Promise<void>
  upsert(nodeFile: string, c: NodeCase, replaceId?: string): Promise<void>
  remove(nodeFile: string, id: string): Promise<void>
  /** Runs cases for these node files (all cases, or only `ids` for a single file). */
  run(nodeFiles: string[], ids?: string[]): Promise<void>
}

const empty = (): NodeCaseFile => ({ lorien: 1, cases: [] })
export const caseKey = (casesPath: string, id: string) => `${casesPath}#${id}`

export const useNodeCases = create<State>((set, get) => {
  const patch = (nodeFile: string, p: Partial<CaseFileEntry>) =>
    set((s) => {
      const cur = s.byNode[nodeFile] ?? {
        path: casesPathFor(nodeFile),
        file: empty(),
        loaded: false,
        error: null,
        saving: false,
      }
      return { byNode: { ...s.byNode, [nodeFile]: { ...cur, ...p } } }
    })

  const write = async (nodeFile: string, file: NodeCaseFile) => {
    const path = casesPathFor(nodeFile)
    const previous = get().byNode[nodeFile]?.file
    patch(nodeFile, { file, saving: true, error: null })
    try {
      await saveFile(path, serializeCaseFile(file))
      patch(nodeFile, { saving: false, loaded: true })
    } catch (e) {
      patch(nodeFile, {
        saving: false,
        error: `Could not save ${path}: ${(e as Error).message}`,
        ...(previous ? { file: previous } : {}),
      })
      throw e
    }
  }

  return {
    byNode: {},
    results: {},
    running: {},
    lastLogs: "",
    runError: null,

    async load(nodeFile) {
      const path = casesPathFor(nodeFile)
      try {
        const { content } = await fetchFile(path)
        patch(nodeFile, { file: parseCaseFile(content, path), loaded: true, error: null })
      } catch (e) {
        if (e instanceof ApiError && e.status === 404)
          patch(nodeFile, { file: empty(), loaded: true, error: null })
        else patch(nodeFile, { loaded: true, error: (e as Error).message })
      }
    },

    async upsert(nodeFile, c, replaceId) {
      const cur = get().byNode[nodeFile]?.file ?? empty()
      const target = replaceId ?? c.id
      const i = cur.cases.findIndex((x) => x.id === target)
      const cases = i === -1 ? [...cur.cases, c] : cur.cases.map((x, j) => (j === i ? c : x))
      await write(nodeFile, { ...cur, cases })
    },

    async remove(nodeFile, id) {
      const cur = get().byNode[nodeFile]?.file ?? empty()
      await write(nodeFile, { ...cur, cases: cur.cases.filter((c) => c.id !== id) })
    },

    async run(nodeFiles, ids) {
      const only: Record<string, string[]> = {}
      for (const nf of nodeFiles) {
        const entry = get().byNode[nf]
        if (!entry) continue
        only[entry.path] = ids ?? entry.file.cases.map((c) => c.id)
      }
      const paths = Object.keys(only)
      if (paths.length === 0) return
      set((s) => ({
        running: { ...s.running, ...Object.fromEntries(paths.map((p) => [p, true])) },
        runError: null,
      }))
      try {
        const run = await runNodeTests({ only })
        const results = { ...get().results }
        const fileErrors: string[] = []
        for (const f of run.files) {
          if (f.error) fileErrors.push(`${f.path}: ${f.error}`)
          for (const r of f.results) results[caseKey(f.path, r.caseId)] = r
        }
        set({
          results,
          lastLogs: run.logs,
          runError: fileErrors.length > 0 ? fileErrors.join("\n") : null,
        })
      } catch (e) {
        set({ runError: (e as Error).message })
      } finally {
        set((s) => ({
          running: { ...s.running, ...Object.fromEntries(paths.map((p) => [p, false])) },
        }))
      }
    },
  }
})

/** Pass/fail counts for a node's cases, for canvas badges. */
export function caseSummary(
  s: Pick<State, "byNode" | "results">,
  nodeFile: string,
): { total: number; passed: number; failed: number; run: number } | null {
  const entry = s.byNode[nodeFile]
  if (!entry || entry.file.cases.length === 0) return null
  let passed = 0
  let failed = 0
  for (const c of entry.file.cases) {
    const r = s.results[caseKey(entry.path, c.id)]
    if (!r) continue
    if (r.passed) passed++
    else failed++
  }
  return { total: entry.file.cases.length, passed, failed, run: passed + failed }
}
