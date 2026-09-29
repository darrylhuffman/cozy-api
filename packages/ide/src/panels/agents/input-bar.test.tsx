import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CONTEXT_MARKER } from "@/ai/prompts"
import type { WorkflowFile } from "@/lib/api"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import { InputBar } from "./input-bar"

vi.mock("@/store/schemas", async (orig) => ({
  ...(await orig<typeof import("@/store/schemas")>()),
  useSchemas: () => ({}),
}))

const wf = {
  lorien: 1,
  nodes: { save: { uses: "./nodes/user/save-user" } },
} as unknown as WorkflowFile

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
  useTabsStore.getState().openTab({
    id: "w",
    title: "create.workflow",
    kind: "workflow",
    path: "workflows/user/create.workflow",
  })
  useLiveWorkflowStore.getState().setLiveWorkflow("w", wf)
  useSelectionStore.setState({ selectedNodeId: null })
  useDebugSessionStore.setState({ runs: [] })
})
afterEach(() => {
  cleanup()
  useLiveWorkflowStore.setState({ workflow: null, tabId: null })
})

function send(text: string) {
  const box = screen.getByLabelText("Message")
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: "Enter" })
}

describe("InputBar context chips", () => {
  it("sends plain text when no workflow is open", () => {
    useLiveWorkflowStore.setState({ workflow: null, tabId: null })
    const onSend = vi.fn()
    render(<InputBar disabled={false} onSend={onSend} />)
    expect(screen.queryByLabelText("Context to include")).not.toBeInTheDocument()
    send("hello")
    expect(onSend).toHaveBeenCalledWith("hello")
  })

  it("attaches the open workflow by default", () => {
    const onSend = vi.fn()
    render(<InputBar disabled={false} onSend={onSend} />)
    expect(screen.getByRole("button", { name: "create.workflow" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    send("why?")
    const [text] = onSend.mock.calls[0] as [string]
    expect(text.startsWith(`why?${CONTEXT_MARKER}`)).toBe(true)
    expect(text).toContain("Open workflow workflows/user/create.workflow")
  })

  it("lets the user turn a chip off", () => {
    const onSend = vi.fn()
    render(<InputBar disabled={false} onSend={onSend} />)
    fireEvent.click(screen.getByRole("button", { name: "create.workflow" }))
    expect(screen.getByRole("button", { name: "create.workflow" })).toHaveAttribute(
      "aria-pressed",
      "false",
    )
    send("why?")
    expect(onSend).toHaveBeenCalledWith("why?")
  })

  it("adds the selected node, and a failed run turned on", () => {
    useSelectionStore.setState({ selectedNodeId: "save" })
    useDebugSessionStore.setState({
      runs: [
        {
          runId: "r",
          workflowPath: "workflows/user/create.workflow",
          triggerNodeId: "req",
          request: { method: "POST", path: "/users" },
          startedAt: 0,
          events: [],
          logs: [],
          pausedFrame: null,
          outcome: { kind: "errored", nodeId: "save", message: "db down" },
        },
      ],
    })
    const onSend = vi.fn()
    render(<InputBar disabled={false} onSend={onSend} />)
    expect(screen.getByRole("button", { name: "save" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "last run: failed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    send("fix it")
    const [text] = onSend.mock.calls[0] as [string]
    expect(text).toContain("Selected node: save (nodes/user/save-user.ts)")
    expect(text).toContain("db down")
  })
})
