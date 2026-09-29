import {
  collectionPathFor,
  parseRequestCollection,
  type RequestCollection,
  type RequestRunResult,
  type SavedRequest,
  serializeCollection,
} from "@darrylondil/lorien-runtime/requests"
import { create } from "zustand"
import { ApiError, fetchFile, saveFile } from "@/lib/api"

export interface CollectionEntry {
  /** `workflows/users/create.requests.json` */
  path: string
  collection: RequestCollection
  loaded: boolean
  error: string | null
  saving: boolean
}

interface State {
  /** Keyed by workflow path. */
  byWorkflow: Record<string, CollectionEntry>
  /** Last run of each saved request, keyed by `${workflowPath}#${requestId}`. */
  results: Record<string, RequestRunResult>
  load(workflowPath: string): Promise<void>
  /** Insert or replace by id, then write the file. */
  upsert(workflowPath: string, req: SavedRequest): Promise<void>
  remove(workflowPath: string, id: string): Promise<void>
  setResult(workflowPath: string, id: string, result: RequestRunResult): void
}

const empty = (): RequestCollection => ({ lorien: 1, requests: [] })

export const resultKey = (workflowPath: string, id: string) => `${workflowPath}#${id}`

export const useRequestCollections = create<State>((set, get) => {
  const patch = (wf: string, p: Partial<CollectionEntry>) =>
    set((s) => {
      const cur = s.byWorkflow[wf] ?? {
        path: collectionPathFor(wf),
        collection: empty(),
        loaded: false,
        error: null,
        saving: false,
      }
      return { byWorkflow: { ...s.byWorkflow, [wf]: { ...cur, ...p } } }
    })

  const write = async (wf: string, collection: RequestCollection) => {
    const path = collectionPathFor(wf)
    const previous = get().byWorkflow[wf]?.collection
    patch(wf, { collection, saving: true, error: null })
    try {
      await saveFile(path, serializeCollection(collection))
      patch(wf, { saving: false, loaded: true })
    } catch (e) {
      // Put the list back so what you see matches the file on disk.
      patch(wf, {
        saving: false,
        error: `Could not save ${path}: ${(e as Error).message}`,
        ...(previous ? { collection: previous } : {}),
      })
      throw e
    }
  }

  return {
    byWorkflow: {},
    results: {},

    async load(wf) {
      const path = collectionPathFor(wf)
      try {
        const { content } = await fetchFile(path)
        patch(wf, { collection: parseRequestCollection(content, path), loaded: true, error: null })
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          patch(wf, { collection: empty(), loaded: true, error: null })
        } else {
          patch(wf, { loaded: true, error: (e as Error).message })
        }
      }
    },

    async upsert(wf, req) {
      const cur = get().byWorkflow[wf]?.collection ?? empty()
      const i = cur.requests.findIndex((r) => r.id === req.id)
      const requests =
        i === -1 ? [...cur.requests, req] : cur.requests.map((r, j) => (j === i ? req : r))
      await write(wf, { ...cur, requests })
    },

    async remove(wf, id) {
      const cur = get().byWorkflow[wf]?.collection ?? empty()
      await write(wf, { ...cur, requests: cur.requests.filter((r) => r.id !== id) })
    },

    setResult(wf, id, result) {
      set((s) => ({ results: { ...s.results, [resultKey(wf, id)]: result } }))
    },
  }
})

/** A readable, unique id for a new request: "Creates a user" → "createsAUser". */
export function requestIdFromName(name: string, taken: string[]): string {
  const words = name.match(/[A-Za-z0-9]+/g) ?? []
  let base = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join("")
  if (!base) base = "request"
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}${n}`
  return id
}
