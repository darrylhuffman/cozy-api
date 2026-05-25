import { create } from "zustand"
import type {
  Breakpoint,
  RequestEnvelope,
  ServerMessage,
} from "@darrylondil/lorien-runtime"
import {
  loadBreakpoints,
  saveBreakpoints,
} from "./debug-breakpoints-storage"

export type RunStatus = "idle" | "running" | "paused" | "completed" | "errored"
export type NodeStatus = "running" | "completed" | "errored" | "paused"
export type BodyKind = "none" | "json" | "xml" | "text" | "form"

export interface TimelineEvent {
  offsetMs: number
  event:
    | { type: "before-node"; nodeId: string; input: Record<string, unknown> }
    | { type: "after-node"; nodeId: string; output: Record<string, unknown>; durationMs: number }
    | { type: "edge-fired"; from: string; to: string; value: unknown }
    | { type: "error"; nodeId: string; error: Error }
    | { type: "complete"; totalMs: number }
}

export interface RunRecord {
  runId: string
  workflowPath: string
  triggerNodeId: string
  request: RequestEnvelope
  startedAt: number
  events: TimelineEvent[]
  outcome:
    | { kind: "ok"; status: number; body: unknown; totalMs: number }
    | { kind: "err"; nodeId?: string; message: string }
    | { kind: "running" }
}

export interface PausedFrame {
  runId: string
  nodeId: string
  phase: "before" | "after"
  payload: unknown
}

interface DebugSessionState {
  connected: boolean
  status: RunStatus
  runs: RunRecord[] // most-recent first; cap at 10
  selectedRunId: string | null
  pausedFrame: PausedFrame | null
  nodeStatuses: Map<string, NodeStatus>
  breakpoints: Breakpoint[]
  lastFire: {
    workflowPath: string
    triggerNodeId: string
    request: RequestEnvelope
  } | null
  requestForm: {
    triggerNodeId: string | null
    method: string
    path: string
    bodyKind: BodyKind
    body: string // raw JSON/XML/text content for the Monaco editor
    formBody: Array<[string, string]>
    query: Array<[string, string]>
    headers: Array<[string, string]>
  }

  // intents
  setConnected: (v: boolean) => void
  recordFire: (
    workflowPath: string,
    triggerNodeId: string,
    request: RequestEnvelope,
  ) => void
  applyMessage: (msg: ServerMessage) => void
  selectRun: (runId: string) => void
  toggleBreakpoint: (bp: Breakpoint) => void
  setBreakpoints: (bps: Breakpoint[]) => void
  hydrateBreakpoints: () => void
  setRequestForm: (
    updater: (cur: DebugSessionState["requestForm"]) => DebugSessionState["requestForm"],
  ) => void
  getInitialState: () => Omit<DebugSessionState, keyof typeof actions>
}

const initialRequestForm: DebugSessionState["requestForm"] = {
  triggerNodeId: null,
  method: "GET",
  path: "/",
  bodyKind: "none",
  body: "",
  formBody: [],
  query: [],
  headers: [],
}

// Snapshot of pure data fields for reset — no functions
const initialData = {
  connected: false,
  status: "idle" as RunStatus,
  runs: [] as RunRecord[],
  selectedRunId: null as string | null,
  pausedFrame: null as PausedFrame | null,
  nodeStatuses: new Map<string, NodeStatus>(),
  breakpoints: [] as Breakpoint[],
  lastFire: null as DebugSessionState["lastFire"],
  requestForm: initialRequestForm,
}

// Placeholder — the real actions object is built inside `create`; used only for typing above.
const actions = {} as Record<string, unknown>

export const useDebugSessionStore = create<DebugSessionState>((set, get) => ({
  ...initialData,

  getInitialState: () => ({ ...initialData, nodeStatuses: new Map() }),

  setConnected: (v) => set({ connected: v }),

  recordFire: (workflowPath, triggerNodeId, request) =>
    set({
      lastFire: { workflowPath, triggerNodeId, request },
      status: "running",
      nodeStatuses: new Map(),
      pausedFrame: null,
    }),

  applyMessage: (msg) => {
    switch (msg.type) {
      case "ready":
        set({ connected: true })
        return
      case "event": {
        const { runId, event, offsetMs } = msg
        set((s) => {
          // Lazy-create a run record if the runId is new
          let runs = s.runs
          if (!runs.find((r) => r.runId === runId)) {
            const lf = s.lastFire
            const record: RunRecord = {
              runId,
              workflowPath: lf?.workflowPath ?? "",
              triggerNodeId: lf?.triggerNodeId ?? "",
              request: lf?.request ?? { method: "GET", path: "/" },
              startedAt: Date.now(),
              events: [],
              outcome: { kind: "running" },
            }
            runs = [record, ...s.runs].slice(0, 10)
          }
          runs = runs.map((r) =>
            r.runId === runId
              ? { ...r, events: [...r.events, { offsetMs, event } as TimelineEvent] }
              : r,
          )
          const nodeStatuses = new Map(s.nodeStatuses)
          let status = s.status
          if (event.type === "before-node") {
            nodeStatuses.set(event.nodeId, "running")
            if (status === "idle") status = "running"
          } else if (event.type === "after-node") {
            nodeStatuses.set(event.nodeId, "completed")
          } else if (event.type === "error") {
            nodeStatuses.set(event.nodeId, "errored")
            status = "errored"
          }
          return { runs, nodeStatuses, status, selectedRunId: s.selectedRunId ?? runId }
        })
        return
      }
      case "paused": {
        set((s) => {
          const nodeStatuses = new Map(s.nodeStatuses)
          nodeStatuses.set(msg.nodeId, "paused")
          return {
            status: "paused",
            pausedFrame: {
              runId: msg.runId,
              nodeId: msg.nodeId,
              phase: msg.phase,
              payload: msg.payload,
            },
            nodeStatuses,
          }
        })
        return
      }
      case "resumed":
        set((s) => {
          const nodeStatuses = new Map(s.nodeStatuses)
          if (s.pausedFrame) {
            nodeStatuses.set(
              s.pausedFrame.nodeId,
              s.pausedFrame.phase === "before" ? "running" : "completed",
            )
          }
          return { status: "running", pausedFrame: null, nodeStatuses }
        })
        return
      case "run-complete":
        set((s) => ({
          status: "completed",
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  outcome: {
                    kind: "ok",
                    status: msg.status,
                    body: msg.body,
                    totalMs: msg.totalMs,
                  },
                }
              : r,
          ),
        }))
        return
      case "run-error":
        set((s) => ({
          status: "errored",
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  outcome: {
                    kind: "err",
                    ...(msg.nodeId !== undefined ? { nodeId: msg.nodeId } : {}),
                    message: msg.message,
                  },
                }
              : r,
          ),
        }))
        return
      case "ack":
        return
    }
  },

  selectRun: (runId) => set({ selectedRunId: runId }),

  toggleBreakpoint: (bp) =>
    set((s) => {
      const existing = s.breakpoints.findIndex(
        (b) =>
          b.workflowPath === bp.workflowPath &&
          b.nodeId === bp.nodeId &&
          b.kind === bp.kind,
      )
      const next =
        existing >= 0
          ? s.breakpoints.filter((_, i) => i !== existing)
          : [...s.breakpoints, bp]
      saveBreakpoints(next)
      return { breakpoints: next }
    }),

  setBreakpoints: (bps) => {
    saveBreakpoints(bps)
    set({ breakpoints: bps })
  },

  hydrateBreakpoints: () => set({ breakpoints: loadBreakpoints() }),

  setRequestForm: (updater) =>
    set((s) => ({ requestForm: updater(s.requestForm) })),
}))
