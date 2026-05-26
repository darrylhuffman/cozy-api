import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useDebugSessionStore } from "./debug-session"
import type { RequestEnvelope, ServerMessage } from "@darrylondil/lorien-runtime"

describe("useDebugSessionStore (multi-active)", () => {
  afterEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState() as never)
    localStorage.clear()
  })

  it("starts with no connection, no runs, no breakpoints", () => {
    const s = useDebugSessionStore.getState()
    expect(s.connected).toBe(false)
    expect(s.runs).toEqual([])
    expect(s.selectedRunId).toBeNull()
    expect(s.breakpoints).toEqual([])
  })

  it("requestForm initial state includes bodyKind='none' and formBody=[]", () => {
    const s = useDebugSessionStore.getState()
    expect(s.requestForm.bodyKind).toBe("none")
    expect(s.requestForm.formBody).toEqual([])
  })

  it("setRequestForm round-trips bodyKind and formBody", () => {
    useDebugSessionStore.getState().setRequestForm((cur) => ({
      ...cur,
      bodyKind: "json",
      formBody: [["k", "v"]],
    }))
    const s = useDebugSessionStore.getState()
    expect(s.requestForm.bodyKind).toBe("json")
    expect(s.requestForm.formBody).toEqual([["k", "v"]])
  })

  it("applyMessage(ready) sets connected", () => {
    useDebugSessionStore.getState().applyMessage({ type: "ready", sessionId: "s1" } as ServerMessage)
    expect(useDebugSessionStore.getState().connected).toBe(true)
  })

  it("event for unknown runId lazy-creates a run record", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "rA",
      event: { type: "before-node", nodeId: "n1", input: {} },
      offsetMs: 0,
    } as ServerMessage)
    expect(useDebugSessionStore.getState().runs[0]?.runId).toBe("rA")
  })

  it("paused message sets the matching run's pausedFrame and outcome=paused", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rA", nodeId: "x", phase: "before", payload: { foo: 1 } } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.pausedFrame?.nodeId).toBe("x")
    expect(r.outcome.kind).toBe("paused")
  })

  it("resumed clears pausedFrame on the matching run only", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rB", event: { type: "before-node", nodeId: "y", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rA", nodeId: "x", phase: "before", payload: null } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rB", nodeId: "y", phase: "before", payload: null } as ServerMessage)
    s.applyMessage({ type: "resumed", runId: "rA" } as ServerMessage)
    const runs = useDebugSessionStore.getState().runs
    expect(runs.find((r) => r.runId === "rA")?.pausedFrame).toBeNull()
    expect(runs.find((r) => r.runId === "rB")?.pausedFrame).not.toBeNull()
  })

  it("log appends to the matching run's logs", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "log", runId: "rA", level: "info", message: "hello", offsetMs: 5 } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.logs).toEqual([{ offsetMs: 5, level: "info", message: "hello" }])
  })

  it("run-complete sets outcome.ok", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "run-complete", runId: "rA", status: 200, body: { ok: true }, totalMs: 42 } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.outcome).toEqual({ kind: "ok", status: 200, body: { ok: true }, totalMs: 42 })
  })

  it("run-error sets outcome.errored with stack and nodeId", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "run-error", runId: "rA", nodeId: "saveUser", message: "boom", stack: "Error: boom\n  at ..." } as ServerMessage)
    const r = useDebugSessionStore.getState().runs[0]!
    expect(r.outcome.kind).toBe("errored")
    if (r.outcome.kind === "errored") {
      expect(r.outcome.message).toBe("boom")
      expect(r.outcome.nodeId).toBe("saveUser")
      expect(r.outcome.stack).toMatch(/Error: boom/)
    }
  })

  it("selectedRun returns the focused run or null", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.selectRun("rA")
    expect(useDebugSessionStore.getState().selectedRun()?.runId).toBe("rA")
  })

  it("nodeStatusesFor reflects the run's events + pause", () => {
    const s = useDebugSessionStore.getState()
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rA", event: { type: "after-node", nodeId: "x", output: {}, durationMs: 1 }, offsetMs: 1 } as ServerMessage)
    s.applyMessage({ type: "event", runId: "rA", event: { type: "before-node", nodeId: "y", input: {} }, offsetMs: 2 } as ServerMessage)
    s.applyMessage({ type: "paused", runId: "rA", nodeId: "y", phase: "before", payload: null } as ServerMessage)
    const statuses = useDebugSessionStore.getState().nodeStatusesFor("rA")
    expect(statuses.get("x")).toBe("completed")
    expect(statuses.get("y")).toBe("paused")
  })

  it("retains at most 20 runs", () => {
    const s = useDebugSessionStore.getState()
    for (let i = 0; i < 22; i++) {
      s.applyMessage({ type: "event", runId: `r${i}`, event: { type: "before-node", nodeId: "x", input: {} }, offsetMs: 0 } as ServerMessage)
    }
    expect(useDebugSessionStore.getState().runs.length).toBe(20)
  })

  it("toggleBreakpoint adds and removes; mirrors to localStorage", () => {
    const bp = {
      workflowPath: "workflows/a.workflow",
      nodeId: "n1",
      kind: "before" as const,
    }
    useDebugSessionStore.getState().toggleBreakpoint(bp)
    expect(useDebugSessionStore.getState().breakpoints).toContainEqual(bp)
    const raw = localStorage.getItem("lorien-debug-breakpoints")
    expect(raw).toBeTruthy()
    useDebugSessionStore.getState().toggleBreakpoint(bp)
    expect(useDebugSessionStore.getState().breakpoints).not.toContainEqual(bp)
  })

  it("hydrateBreakpoints loads from localStorage", () => {
    const bp = {
      workflowPath: "workflows/a.workflow",
      nodeId: "n1",
      kind: "before" as const,
    }
    localStorage.setItem("lorien-debug-breakpoints", JSON.stringify([bp]))
    useDebugSessionStore.getState().hydrateBreakpoints()
    expect(useDebugSessionStore.getState().breakpoints).toEqual([bp])
  })
})

describe("debug-session store — run-started", () => {
  beforeEach(() => {
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("creates a RunRecord with the real envelope and sets selectedRunId if null", () => {
    const request: RequestEnvelope = {
      method: "POST",
      path: "/users",
      query: { lang: "en" },
      headers: { "x-test": "1" },
      body: { email: "a@b.com" },
    }

    useDebugSessionStore.getState().applyMessage({
      type: "run-started",
      runId: "r-1",
      workflowPath: "workflows/users/create.workflow",
      triggerNodeId: "Request",
      request,
    })

    const s = useDebugSessionStore.getState()
    expect(s.runs).toHaveLength(1)
    const r = s.runs[0]!
    expect(r.runId).toBe("r-1")
    expect(r.workflowPath).toBe("workflows/users/create.workflow")
    expect(r.triggerNodeId).toBe("Request")
    expect(r.request).toEqual(request)
    expect(r.outcome).toEqual({ kind: "running" })
    expect(r.events).toEqual([])
    expect(r.logs).toEqual([])
    expect(s.selectedRunId).toBe("r-1")
  })

  it("is idempotent — duplicate run-started for same runId does not duplicate the record", () => {
    const request: RequestEnvelope = { method: "GET", path: "/health" }
    const msg = {
      type: "run-started" as const,
      runId: "r-dup",
      workflowPath: "wf",
      triggerNodeId: "T",
      request,
    }
    useDebugSessionStore.getState().applyMessage(msg)
    useDebugSessionStore.getState().applyMessage(msg)
    expect(useDebugSessionStore.getState().runs).toHaveLength(1)
  })

  it("events after run-started append to the existing record (no second placeholder)", () => {
    useDebugSessionStore.getState().applyMessage({
      type: "run-started",
      runId: "r-2",
      workflowPath: "wf",
      triggerNodeId: "T",
      request: { method: "POST", path: "/x" },
    })
    useDebugSessionStore.getState().applyMessage({
      type: "event",
      runId: "r-2",
      offsetMs: 5,
      event: { type: "before-node", nodeId: "n1", input: {} },
    })

    const s = useDebugSessionStore.getState()
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0]!.events).toHaveLength(1)
    // path stays from run-started, not overwritten by the lazy-create placeholder
    expect(s.runs[0]!.request.path).toBe("/x")
  })
})
