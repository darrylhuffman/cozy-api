import { create } from "zustand"
import type { RequestEnvelope } from "@darrylondil/lorien-runtime"

export interface RequestHistoryEntry {
  id: string
  workflowPath: string
  triggerNodeId: string
  request: RequestEnvelope
  startedAt: number
  outcome:
    | { kind: "in-flight" }
    | {
        kind: "ok"
        status: number
        headers: Record<string, string>
        body: unknown
        durationMs: number
      }
    | {
        kind: "error"
        status: number
        headers: Record<string, string>
        body: unknown
        durationMs: number
      }
    | { kind: "network-error"; message: string }
}

interface State {
  entries: RequestHistoryEntry[]
  addEntry: (e: Omit<RequestHistoryEntry, "id" | "outcome">) => string
  setResponse: (
    id: string,
    res: {
      status: number
      headers: Record<string, string>
      body: unknown
      durationMs: number
    },
  ) => void
  setError: (id: string, message: string) => void
  clear: () => void
}

let nextIdCounter = 0
const makeId = () => `h-${Date.now()}-${nextIdCounter++}`

export const useRequestHistoryStore = create<State>((set) => ({
  entries: [],
  addEntry: (e) => {
    const id = makeId()
    set((s) => ({
      entries: [{ ...e, id, outcome: { kind: "in-flight" } as const }, ...s.entries].slice(0, 20),
    }))
    return id
  },
  setResponse: (id, res) =>
    set((s) => ({
      entries: s.entries.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              outcome:
                res.status < 400
                  ? {
                      kind: "ok",
                      status: res.status,
                      headers: res.headers,
                      body: res.body,
                      durationMs: res.durationMs,
                    }
                  : {
                      kind: "error",
                      status: res.status,
                      headers: res.headers,
                      body: res.body,
                      durationMs: res.durationMs,
                    },
            }
          : entry,
      ),
    })),
  setError: (id, message) =>
    set((s) => ({
      entries: s.entries.map((entry) =>
        entry.id === id
          ? { ...entry, outcome: { kind: "network-error", message } }
          : entry,
      ),
    })),
  clear: () => set({ entries: [] }),
}))
