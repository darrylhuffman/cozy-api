import type { ServerMessage } from "@darrylondil/lorien-runtime"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { useDebugSessionStore } from "@/store/debug-session"
import { Timeline } from "./timeline"

describe("Timeline", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState() as never)
  })

  it("nests a sub-workflow's steps under its node, by their own ids", () => {
    const s = useDebugSessionStore.getState()
    const frames = (inner: string) => [
      { workflowPath: "workflows/o.workflow", nodeId: "Reserve" },
      { workflowPath: "nodes/orders/reserve.workflow", nodeId: inner },
    ]
    s.applyMessage({
      type: "run-started",
      runId: "r1",
      workflowPath: "workflows/o.workflow",
      triggerNodeId: "Request",
      request: { method: "POST", path: "/o" },
      origins: {
        Reserve__Input: { frames: frames("Input"), role: "input" },
        Reserve__Find: { frames: frames("Find") },
      },
    } as ServerMessage)
    for (const nodeId of ["Request", "Reserve__Input", "Reserve__Find"]) {
      s.applyMessage({
        type: "event",
        runId: "r1",
        event: { type: "before-node", nodeId, input: {} },
        offsetMs: 0,
      } as ServerMessage)
    }
    render(<Timeline runId="r1" />)
    expect(screen.getByText("Reserve")).toBeInTheDocument()
    expect(screen.getByText("orders/reserve")).toBeInTheDocument()
    expect(screen.getByTitle("Reserve__Find")).toHaveTextContent(/^Find$/)
    // One heading for the group, not one per step.
    expect(screen.getAllByText("Reserve")).toHaveLength(1)
  })
})
