import { create } from "zustand"
import type {
  Breakpoint,
  ClientMessage,
  RequestEnvelope,
  ServerMessage,
  WireLifecycleEvent,
} from "@darrylondil/lorien-runtime"
import {
  loadBreakpoints,
  saveBreakpoints,
} from "./debug-breakpoints-storage"

export type NodeStatus = "running" | "completed" | "errored" | "paused"
export type BodyKind = "none" | "json" | "xml" | "text" | "form"

export interface TimelineEvent {
  offsetMs: number
  event: WireLifecycleEvent
}

export interface LogEntry {
  offsetMs: number
  level: "log" | "info" | "warn" | "error"
  message: string
}

export interface PausedFrame {
  nodeId: string
  phase: "before" | "after"
  payload: unknown
}

export interface RunRecord {
  runId: string
  workflowPath: string
  triggerNodeId: string
  request: RequestEnvelope
  startedAt: number
  events: TimelineEvent[]
  logs: LogEntry[]
  pausedFrame: PausedFrame | null
  outcome:
    | { kind: "running" }
    | { kind: "paused" }
    | { kind: "ok"; status: number; body: unknown; totalMs: number }
    | {
        kind: "errored"
        nodeId?: string
        message: string
        stack?: string
        totalMs?: number
      }
}

interface DebugSessionState {
  connected: boolean
  runs: RunRecord[]
  selectedRunId: string | null
  breakpoints: Breakpoint[]
  requestForm: {
    triggerNodeId: string | null
    method: string
    path: string
    bodyKind: BodyKind
    body: string
    formBody: Array<[string, string]>
    query: Array<[string, string]>
    headers: Array<[string, string]>
  }
  wsSender: ((msg: ClientMessage) => void) | null

  // intents
  setConnected: (v: boolean) => void
  setWsSender: (send: (msg: ClientMessage) => void) => void
  applyMessage: (msg: ServerMessage) => void
  selectRun: (runId: string) => void
  toggleBreakpoint: (bp: Breakpoint) => void
  setBreakpoints: (bps: Breakpoint[]) => void
  hydrateBreakpoints: () => void
  setRequestForm: (
    updater: (cur: DebugSessionState["requestForm"]) => DebugSessionState["requestForm"],
  ) => void

  sendContinue: (runId: string) => void
  sendStep: (runId: string) => void
  sendStepOver: (runId: string) => void
  sendStop: (runId: string) => void

  // selectors
  selectedRun: () => RunRecord | null
  nodeStatusesFor: (runId: string | null) => Map<string, NodeStatus>

  getInitialState: () => Pick<
    DebugSessionState,
    "connected" | "runs" | "selectedRunId" | "breakpoints" | "requestForm" | "wsSender"
  >
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

const initialData = {
  connected: false,
  runs: [] as RunRecord[],
  selectedRunId: null as string | null,
  breakpoints: [] as Breakpoint[],
  requestForm: initialRequestForm,
  wsSender: null as DebugSessionState["wsSender"],
}

export const useDebugSessionStore = create<DebugSessionState>((set, get) => ({
  ...initialData,

  getInitialState: () => ({ ...initialData }),

  setConnected: (v) => set({ connected: v }),
  setWsSender: (send) => set({ wsSender: send }),

  applyMessage: (msg) => {
    switch (msg.type) {
      case "ready":
        set({ connected: true })
        return
      case "run-started": {
        const { runId, workflowPath, triggerNodeId, request } = msg
        set((s) => {
          if (s.runs.find((r) => r.runId === runId)) return s
          const record: RunRecord = {
            runId,
            workflowPath,
            triggerNodeId,
            request,
            startedAt: Date.now(),
            events: [],
            logs: [],
            pausedFrame: null,
            outcome: { kind: "running" },
          }
          const runs = [record, ...s.runs].slice(0, 20)
          return { runs, selectedRunId: s.selectedRunId ?? runId }
        })
        return
      }
      case "event": {
        const { runId, event, offsetMs } = msg
        set((s) => {
          let runs = s.runs
          if (!runs.find((r) => r.runId === runId)) {
            // Defensive: run-started should always arrive before any event. If we land
            // here, the server skipped it or the IDE bundle is stale. Warn loudly and
            // create a placeholder so the timeline isn't lost.
            console.warn(
              `[debug-session] event arrived before run-started for runId=${runId}`,
            )
            const record: RunRecord = {
              runId,
              workflowPath: "",
              triggerNodeId: "",
              request: { method: "?", path: "?" },
              startedAt: Date.now(),
              events: [],
              logs: [],
              pausedFrame: null,
              outcome: { kind: "running" },
            }
            runs = [record, ...s.runs].slice(0, 20)
          }
          runs = runs.map((r) =>
            r.runId === runId
              ? { ...r, events: [...r.events, { offsetMs, event }] }
              : r,
          )
          return { runs, selectedRunId: s.selectedRunId ?? runId }
        })
        return
      }
      case "log": {
        const { runId, level, message, offsetMs } = msg
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === runId
              ? { ...r, logs: [...r.logs, { offsetMs, level, message }] }
              : r,
          ),
        }))
        return
      }
      case "paused":
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  pausedFrame: {
                    nodeId: msg.nodeId,
                    phase: msg.phase,
                    payload: msg.payload,
                  },
                  outcome: { kind: "paused" },
                }
              : r,
          ),
        }))
        return
      case "resumed":
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? { ...r, pausedFrame: null, outcome: { kind: "running" } }
              : r,
          ),
        }))
        return
      case "run-complete":
        set((s) => ({
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  pausedFrame: null,
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
          runs: s.runs.map((r) =>
            r.runId === msg.runId
              ? {
                  ...r,
                  pausedFrame: null,
                  outcome: {
                    kind: "errored",
                    ...(msg.nodeId !== undefined ? { nodeId: msg.nodeId } : {}),
                    message: msg.message,
                    ...(msg.stack !== undefined ? { stack: msg.stack } : {}),
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

  sendContinue: (runId) => get().wsSender?.({ type: "continue", runId }),
  sendStep: (runId) => get().wsSender?.({ type: "step", runId }),
  sendStepOver: (runId) => get().wsSender?.({ type: "step-over", runId }),
  sendStop: (runId) => get().wsSender?.({ type: "stop", runId }),

  selectedRun: () => {
    const s = get()
    return s.runs.find((r) => r.runId === s.selectedRunId) ?? null
  },

  nodeStatusesFor: (runId) => {
    if (!runId) return new Map<string, NodeStatus>()
    const s = get()
    const run = s.runs.find((r) => r.runId === runId)
    if (!run) return new Map<string, NodeStatus>()
    const statuses = new Map<string, NodeStatus>()
    for (const e of run.events) {
      if (e.event.type === "before-node") statuses.set(e.event.nodeId, "running")
      else if (e.event.type === "after-node") statuses.set(e.event.nodeId, "completed")
      else if (e.event.type === "error") statuses.set(e.event.nodeId, "errored")
    }
    if (run.pausedFrame) statuses.set(run.pausedFrame.nodeId, "paused")
    return statuses
  },
}))
