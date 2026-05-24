import { describe, expect, it } from "vitest"
import { DebugSession } from "./debug-session.js"
import type { Breakpoint, ServerMessage } from "./debug-protocol.js"

// Minimal mock client capturing broadcast messages
function makeMockClient() {
  const sent: ServerMessage[] = []
  const ws = {
    send: (data: string) => {
      sent.push(JSON.parse(data) as ServerMessage)
    },
    readyState: 1, // OPEN
    OPEN: 1,
  } as unknown as import("ws").WebSocket
  return { ws, sent }
}

describe("DebugSession — state + commands", () => {
  function makeSession() {
    return new DebugSession({
      getWorkflow: () => null,
      getServices: async () => ({}),
      resolveNode: () => null,
    })
  }

  it("connect/disconnect tracks clients", () => {
    const session = makeSession()
    const a = makeMockClient()
    const b = makeMockClient()
    session.connect(a.ws)
    session.connect(b.ws)
    expect(session.clientCount).toBe(2)
    session.disconnect(a.ws)
    expect(session.clientCount).toBe(1)
  })

  it("hello replaces breakpoints and emits ready", async () => {
    const session = makeSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    const bps: Breakpoint[] = [
      { workflowPath: "workflows/a.workflow", nodeId: "n1", kind: "before" },
    ]
    await session.onMessage(ws, { type: "hello", breakpoints: bps })
    expect(sent.some((m) => m.type === "ready")).toBe(true)
    expect(session.getBreakpoints("workflows/a.workflow")).toEqual(bps)
  })

  it("set-breakpoints fully replaces per workflow path", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [
        { workflowPath: "a", nodeId: "n1", kind: "before" },
        { workflowPath: "b", nodeId: "n2", kind: "after" },
      ],
    })
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "a", nodeId: "n9", kind: "before" }],
    })
    expect(session.getBreakpoints("a")).toEqual([
      { workflowPath: "a", nodeId: "n9", kind: "before" },
    ])
    expect(session.getBreakpoints("b")).toEqual([])
  })

  it("continue resolves activePause and broadcasts resumed", async () => {
    const session = makeSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    let resolved = false
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => { resolved = true },
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    await session.onMessage(ws, { type: "continue" })
    expect(resolved).toBe(true)
    expect(sent.some((m) => m.type === "resumed" && m.runId === "r1")).toBe(true)
  })

  it("continue with no active pause is a no-op", async () => {
    const session = makeSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, { type: "continue" })
    expect(sent.some((m) => m.type === "resumed")).toBe(false)
  })

  it("step sets stepMode to 'step' and resolves any active pause", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    await session.onMessage(ws, { type: "step" })
    expect(session.stepMode).toBe("step")
  })

  it("step-over sets stepOverNodeId from current pause frame", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    session._setPauseFrameForTest({
      runId: "r1",
      nodeId: "parseBody",
      phase: "before",
    })
    await session.onMessage(ws, { type: "step-over" })
    expect(session.stepMode).toBe("step-over")
    expect(session.stepOverNodeId).toBe("parseBody")
  })

  it("step-over from after-pause is a no-op (only meaningful from before)", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    session.setActiveRunForTest({ runId: "r1" })
    session._setPauseFrameForTest({
      runId: "r1",
      nodeId: "parseBody",
      phase: "after",
    })
    await session.onMessage(ws, { type: "step-over" })
    expect(session.stepMode).toBe("none")
    expect(session.stepOverNodeId).toBeNull()
  })

  it("stop rejects activePause with AbortError", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    let rejection: unknown = null
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: (e) => { rejection = e },
    })
    session.setActiveRunForTest({ runId: "r1" })
    await session.onMessage(ws, { type: "stop" })
    expect((rejection as Error).name).toBe("AbortError")
  })

  it("disconnect rejects activePause if last client leaves", () => {
    const session = makeSession()
    const a = makeMockClient()
    session.connect(a.ws)
    let rejection: unknown = null
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: (e) => { rejection = e },
    })
    session.setActiveRunForTest({ runId: "r1" })
    session.disconnect(a.ws)
    expect((rejection as Error).name).toBe("AbortError")
  })
})
