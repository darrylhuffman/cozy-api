import { describe, expect, it, vi } from "vitest"
import {
  type RequestEnvelope,
  type ServerMessage,
  DebugSession,
} from "@darrylondil/lorien-runtime"
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
    expect(sequence.indexOf("broadcast:run-started")).toBeLessThan(
      sequence.indexOf("registerRun"),
    )
  })
})
