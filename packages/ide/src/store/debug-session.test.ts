import { afterEach, describe, expect, it } from "vitest"
import { useDebugSessionStore } from "./debug-session"
import type {
  Breakpoint,
  ServerMessage,
} from "@darrylondil/lorien-runtime"

describe("useDebugSessionStore", () => {
  afterEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getInitialState())
    localStorage.clear()
  })

  it("starts idle with no runs", () => {
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("idle")
    expect(s.runs).toEqual([])
    expect(s.selectedRunId).toBeNull()
    expect(s.pausedFrame).toBeNull()
    expect(s.breakpoints).toEqual([])
  })

  it("applies a 'ready' message and marks connected", () => {
    useDebugSessionStore.getState().applyMessage({ type: "ready", sessionId: "s-1" })
    expect(useDebugSessionStore.getState().connected).toBe(true)
  })

  it("event for unknown runId lazy-creates a run record from lastFire", () => {
    const store = useDebugSessionStore.getState()
    store.recordFire("workflows/a.workflow", "trig", { method: "GET", path: "/" })
    store.applyMessage({
      type: "event",
      runId: "r-server-1",
      offsetMs: 0,
      event: { type: "before-node", nodeId: "trig", input: {} },
    })
    const runs = useDebugSessionStore.getState().runs
    expect(runs[0]?.runId).toBe("r-server-1")
    expect(runs[0]?.workflowPath).toBe("workflows/a.workflow")
  })

  it("event of type before-node sets node status to 'running' and status to 'running'", () => {
    const store = useDebugSessionStore.getState()
    store.recordFire("wf", "trig", { method: "GET", path: "/" })
    store.applyMessage({
      type: "event",
      runId: "r1",
      offsetMs: 0,
      event: { type: "before-node", nodeId: "parseBody", input: {} },
    })
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("running")
    expect(s.nodeStatuses.get("parseBody")).toBe("running")
  })

  it("event of type after-node sets node status to 'completed'", () => {
    const store = useDebugSessionStore.getState()
    store.recordFire("wf", "trig", { method: "GET", path: "/" })
    store.applyMessage({
      type: "event",
      runId: "r1",
      offsetMs: 12,
      event: { type: "after-node", nodeId: "parseBody", output: {}, durationMs: 12 },
    })
    expect(useDebugSessionStore.getState().nodeStatuses.get("parseBody")).toBe("completed")
  })

  it("event of type error sets node status to 'errored' and status to 'errored'", () => {
    const store = useDebugSessionStore.getState()
    store.recordFire("wf", "trig", { method: "GET", path: "/" })
    store.applyMessage({
      type: "event",
      runId: "r1",
      offsetMs: 0,
      event: { type: "error", nodeId: "saveUser", error: new Error("boom") },
    })
    const s = useDebugSessionStore.getState()
    expect(s.nodeStatuses.get("saveUser")).toBe("errored")
    expect(s.status).toBe("errored")
  })

  it("paused message sets status='paused' and pausedFrame", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "paused",
      runId: "r1",
      nodeId: "saveUser",
      phase: "before",
      payload: { x: 1 },
    })
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("paused")
    expect(s.pausedFrame).toEqual({
      runId: "r1",
      nodeId: "saveUser",
      phase: "before",
      payload: { x: 1 },
    })
    expect(s.nodeStatuses.get("saveUser")).toBe("paused")
  })

  it("resumed message clears pausedFrame, restores 'running'", () => {
    const store = useDebugSessionStore.getState()
    store.applyMessage({
      type: "paused",
      runId: "r1",
      nodeId: "x",
      phase: "before",
      payload: null,
    })
    store.applyMessage({ type: "resumed", runId: "r1" })
    const s = useDebugSessionStore.getState()
    expect(s.pausedFrame).toBeNull()
    expect(s.status).toBe("running")
  })

  it("run-complete sets status='completed' and snapshots the run outcome", () => {
    const store = useDebugSessionStore.getState()
    store.recordFire("workflows/echo.workflow", "request", {
      method: "POST",
      path: "/echo",
      body: {},
    })
    // Trigger event to create the run record (lazy creation)
    store.applyMessage({
      type: "event",
      runId: "r1",
      offsetMs: 0,
      event: { type: "before-node", nodeId: "request", input: {} },
    })
    store.applyMessage({
      type: "run-complete",
      runId: "r1",
      status: 200,
      body: { ok: true },
      totalMs: 42,
    })
    const s = useDebugSessionStore.getState()
    expect(s.status).toBe("completed")
    expect(s.runs[0]?.runId).toBe("r1")
    expect(s.runs[0]?.outcome).toEqual({
      kind: "ok",
      status: 200,
      body: { ok: true },
      totalMs: 42,
    })
  })

  it("retains at most the last 10 runs", () => {
    const store = useDebugSessionStore.getState()
    for (let i = 0; i < 12; i++) {
      store.recordFire("wf", "trig", { method: "GET", path: "/" })
      store.applyMessage({
        type: "event",
        runId: `r${i}`,
        offsetMs: 0,
        event: { type: "before-node", nodeId: "trig", input: {} },
      })
      store.applyMessage({
        type: "run-complete",
        runId: `r${i}`,
        status: 200,
        body: null,
        totalMs: 1,
      })
    }
    const runs = useDebugSessionStore.getState().runs
    expect(runs.length).toBe(10)
    expect(runs[0]?.runId).toBe("r11")
  })

  it("toggleBreakpoint adds and removes; mirrors to localStorage", () => {
    const bp: Breakpoint = {
      workflowPath: "workflows/a.workflow",
      nodeId: "n1",
      kind: "before",
    }
    useDebugSessionStore.getState().toggleBreakpoint(bp)
    expect(useDebugSessionStore.getState().breakpoints).toContainEqual(bp)
    const raw = localStorage.getItem("lorien-debug-breakpoints")
    expect(raw).toBeTruthy()
    useDebugSessionStore.getState().toggleBreakpoint(bp)
    expect(useDebugSessionStore.getState().breakpoints).not.toContainEqual(bp)
  })

  it("hydrateBreakpoints loads from localStorage", () => {
    const bp: Breakpoint = {
      workflowPath: "workflows/a.workflow",
      nodeId: "n1",
      kind: "before",
    }
    localStorage.setItem("lorien-debug-breakpoints", JSON.stringify([bp]))
    useDebugSessionStore.getState().hydrateBreakpoints()
    expect(useDebugSessionStore.getState().breakpoints).toEqual([bp])
  })
})
