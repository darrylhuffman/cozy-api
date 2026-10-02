import { DebugSession, type RequestEnvelope, type ServerMessage } from "@darrylondil/lorien-runtime"
import { describe, expect, it, vi } from "vitest"
import { makeDebugIntegration } from "./debug-integration.js"

describe("makeDebugIntegration.buildRun", () => {
  it("broadcasts run-started with the envelope before registerRun runs", () => {
    const session = new DebugSession()
    const broadcasts: ServerMessage[] = []
    const sequence: string[] = []
    vi.spyOn(session, "broadcast").mockImplementation((msg) => {
      broadcasts.push(msg)
      sequence.push(`broadcast:${msg.type}`)
    })
    vi.spyOn(session, "registerRun").mockImplementation(() => {
      sequence.push("registerRun")
      return { onBeforeNode: async () => {}, onAfterNode: async () => {} }
    })

    const debug = makeDebugIntegration(session)
    const request: RequestEnvelope = {
      method: "POST",
      path: "/users",
      query: { source: "web" },
      headers: { "content-type": "application/json" },
      body: { email: "a@b.com" },
    }

    debug.buildRun("run-99", "workflows/users/create.workflow", "Request", request)

    expect(broadcasts).toContainEqual({
      type: "run-started",
      runId: "run-99",
      workflowPath: "workflows/users/create.workflow",
      triggerNodeId: "Request",
      request,
    })
    // run-started must be the FIRST thing that happens in buildRun
    expect(sequence[0]).toBe("broadcast:run-started")
    expect(sequence).toContain("registerRun")
    expect(sequence.indexOf("broadcast:run-started")).toBeLessThan(sequence.indexOf("registerRun"))
  })
})

describe("makeDebugIntegration with sub-workflows", () => {
  it("sends where flattened nodes came from, and hands it to the session", () => {
    const session = new DebugSession()
    const broadcasts: ServerMessage[] = []
    vi.spyOn(session, "broadcast").mockImplementation((msg) => {
      broadcasts.push(msg)
    })
    const register = vi.spyOn(session, "registerRun")
    const origins = {
      Reserve__Find: {
        frames: [
          { workflowPath: "workflows/a.workflow", nodeId: "Reserve" },
          { workflowPath: "nodes/r.workflow", nodeId: "Find" },
        ],
      },
    }
    makeDebugIntegration(session).buildRun(
      "run-1",
      "workflows/a.workflow",
      "Request",
      { method: "GET", path: "/" },
      origins,
    )
    expect(broadcasts[0]).toMatchObject({ type: "run-started", origins })
    expect(register).toHaveBeenCalledWith(
      "workflows/a.workflow",
      "run-1",
      expect.any(Number),
      origins,
    )
  })
})
