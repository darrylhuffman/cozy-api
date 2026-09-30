import type { Assertion, RequestRunResult } from "@darrylondil/lorien-runtime/requests"
import { create } from "zustand"
import type { MockRow } from "@/panels/run-tab/saved-request-form"

/**
 * The parts of the Run tab's request that the debug form doesn't carry: which
 * saved request is open, its name, assertions and captures, and the last
 * result shown under the builder.
 */
interface State {
  /** Workflow the open request belongs to. */
  workflowPath: string | null
  /** Id of the saved request being edited; null for an unsaved scratch request. */
  editingId: string | null
  name: string
  expect: Assertion[]
  capture: Array<[string, string]>
  mocks: MockRow[]
  lastResult: RequestRunResult | null
  sending: boolean
  setName(name: string): void
  setExpect(expect: Assertion[]): void
  setCapture(capture: Array<[string, string]>): void
  setMocks(mocks: MockRow[]): void
  open(v: {
    id: string | null
    name: string
    expect: Assertion[]
    capture: Array<[string, string]>
    mocks?: MockRow[]
  }): void
  setLastResult(r: RequestRunResult | null): void
  setSending(v: boolean): void
  reset(): void
  /** Switch to a workflow; clears the builder when it is a different one. */
  bindWorkflow(path: string): void
}

const initial = {
  workflowPath: null as string | null,
  editingId: null,
  name: "",
  expect: [] as Assertion[],
  capture: [] as Array<[string, string]>,
  mocks: [] as MockRow[],
  lastResult: null,
  sending: false,
}

export const useRequestEditor = create<State>((set, get) => ({
  ...initial,
  setName: (name) => set({ name }),
  setExpect: (expect) => set({ expect }),
  setCapture: (capture) => set({ capture }),
  setMocks: (mocks) => set({ mocks }),
  open: ({ id, name, expect, capture, mocks = [] }) =>
    set({ editingId: id, name, expect, capture, mocks, lastResult: null }),
  setLastResult: (lastResult) => set({ lastResult }),
  setSending: (sending) => set({ sending }),
  reset: () => set(initial),
  bindWorkflow: (path) => {
    if (get().workflowPath !== path) set({ ...initial, workflowPath: path })
  },
}))
