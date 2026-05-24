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
    session._setActiveRunForTest({ runId: "r1" })
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
    session._setActiveRunForTest({ runId: "r1" })
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
    session._setActiveRunForTest({ runId: "r1" })
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
    session._setActiveRunForTest({ runId: "r1" })
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
    session._setActiveRunForTest({ runId: "r1" })
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
    session._setActiveRunForTest({ runId: "r1" })
    session.disconnect(a.ws)
    expect((rejection as Error).name).toBe("AbortError")
  })

  it("stop clears stepMode and stepOverNodeId", async () => {
    const session = makeSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session.stepMode = "step-over"
    session.stepOverNodeId = "parseBody"
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    await session.onMessage(ws, { type: "stop" })
    expect(session.stepMode).toBe("none")
    expect(session.stepOverNodeId).toBeNull()
  })

  it("last-client disconnect clears stepMode and stepOverNodeId", () => {
    const session = makeSession()
    const a = makeMockClient()
    session.connect(a.ws)
    session.stepMode = "step"
    session.stepOverNodeId = "x"
    session._setActivePauseForTest({
      runId: "r1",
      resolve: () => {},
      reject: () => {},
    })
    session.disconnect(a.ws)
    expect(session.stepMode).toBe("none")
    expect(session.stepOverNodeId).toBeNull()
  })
})

describe("DebugSession.buildHooks — pause matrix", () => {
  function newSession() {
    return new DebugSession({
      getWorkflow: () => null,
      getServices: async () => ({}),
      resolveNode: () => null,
    })
  }

  it("no breakpoints, no step → never pauses", async () => {
    const session = newSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    const { onBeforeNode, onAfterNode } = session.buildHooks("wf", "run-1")
    await expect(Promise.race([
      onBeforeNode("n1", {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), 50)),
    ])).resolves.toBeUndefined()
    await expect(Promise.race([
      onAfterNode("n1", {}),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), 50)),
    ])).resolves.toBeUndefined()
  })

  it("before-bp on node X pauses in onBeforeNode(X)", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "before" }],
    })
    const { onBeforeNode } = session.buildHooks("wf", "run-1")
    const pending = onBeforeNode("X", { foo: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "X" && m.phase === "before")).toBe(true)
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("port-bp on node X pauses in onAfterNode(X)", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:foo" }],
    })
    const { onAfterNode } = session.buildHooks("wf", "run-1")
    const pending = onAfterNode("X", { foo: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "X" && m.phase === "after")).toBe(true)
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("step pauses at the very next hook call", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    session.stepMode = "step"
    const { onBeforeNode } = session.buildHooks("wf", "run-1")
    const pending = onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "Y")).toBe(true)
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("step-over of X suppresses port-bps on X, pauses at next node's before", async () => {
    const session = newSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "wf", nodeId: "X", kind: "port:p" }],
    })
    session.stepMode = "step-over"
    session.stepOverNodeId = "X"
    const { onBeforeNode, onAfterNode } = session.buildHooks("wf", "run-1")
    await onAfterNode("X", {})
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "X" && m.phase === "after")).toBe(false)
    const pending = onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.some((m) => m.type === "paused" && m.nodeId === "Y" && m.phase === "before")).toBe(true)
    await session.onMessage(ws, { type: "continue" })
    await pending
  })

  it("on actual pause, stepMode is cleared so subsequent runs don't auto-step", async () => {
    const session = newSession()
    const { ws } = makeMockClient()
    session.connect(ws)
    session.stepMode = "step"
    const { onBeforeNode } = session.buildHooks("wf", "run-1")
    const pending = onBeforeNode("Y", {})
    await new Promise((r) => setTimeout(r, 10))
    expect(session.stepMode).toBe("none")
    await session.onMessage(ws, { type: "continue" })
    await pending
  })
})

import { defineNode } from "../define-node.js"
import { z } from "zod"
import type { LoadedWorkflow } from "./load.js"

describe("DebugSession.fire — workflow integration", () => {
  function tinyLoadedWorkflow(): LoadedWorkflow {
    const file = {
      lorien: 1 as const,
      nodes: {
        request: {
          uses: "@core/http-request" as const,
          values: { path: "/echo", method: "POST" },
        },
        echo: {
          uses: "./nodes/echo" as const,
          in: { msg: "request.body.msg" },
        },
        response: {
          uses: "@core/response" as const,
          in: { body: "echo.msg" },
        },
      },
    }
    return {
      relativePath: "workflows/echo.workflow",
      file,
    } as unknown as LoadedWorkflow
  }

  const echoNode = defineNode({
    name: "echo",
    inputs: z.object({ msg: z.string() }),
    outputs: z.object({ msg: z.string() }),
    async run({ msg }) {
      return { msg }
    },
  })

  function makeFireSession() {
    const wf = tinyLoadedWorkflow()
    return new DebugSession({
      getWorkflow: (path) => (path === wf.relativePath ? wf : null),
      getServices: async () => ({}) as never,
      resolveNode: (uses) => {
        if (uses === "./nodes/echo") return echoNode
        return null
      },
    })
  }

  it("fire runs the workflow end-to-end and emits run-complete", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "hi" } },
    })
    await new Promise((r) => setTimeout(r, 50))
    const complete = sent.find((m) => m.type === "run-complete")
    expect(complete).toBeTruthy()
    expect((complete as Extract<ServerMessage, { type: "run-complete" }>).body).toBe("hi")
  })

  it("fire broadcasts lifecycle events as 'event' server messages", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "hi" } },
    })
    await new Promise((r) => setTimeout(r, 50))
    const events = sent.filter((m): m is Extract<ServerMessage, { type: "event" }> => m.type === "event")
    expect(events.some((e) => e.event.type === "before-node" && e.event.nodeId === "echo")).toBe(true)
    expect(events.some((e) => e.event.type === "after-node" && e.event.nodeId === "echo")).toBe(true)
  })

  it("fire while running → run-error", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "set-breakpoints",
      breakpoints: [{ workflowPath: "workflows/echo.workflow", nodeId: "echo", kind: "before" }],
    })
    void session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "first" } },
    })
    await new Promise((r) => setTimeout(r, 30))
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "second" } },
    })
    const err = sent.find((m) => m.type === "run-error")
    expect(err).toBeTruthy()
    expect((err as Extract<ServerMessage, { type: "run-error" }>).message).toMatch(/in flight|already running/i)
    await session.onMessage(ws, { type: "continue" })
  })

  it("replay re-fires the last request envelope", async () => {
    const session = makeFireSession()
    const { ws, sent } = makeMockClient()
    session.connect(ws)
    await session.onMessage(ws, {
      type: "fire",
      workflowPath: "workflows/echo.workflow",
      triggerNodeId: "request",
      request: { method: "POST", path: "/echo", body: { msg: "first" } },
    })
    await new Promise((r) => setTimeout(r, 50))
    const firstCompletes = sent.filter((m) => m.type === "run-complete").length
    expect(firstCompletes).toBe(1)
    await session.onMessage(ws, { type: "replay" })
    await new Promise((r) => setTimeout(r, 50))
    const secondCompletes = sent.filter((m) => m.type === "run-complete").length
    expect(secondCompletes).toBe(2)
  })
})
