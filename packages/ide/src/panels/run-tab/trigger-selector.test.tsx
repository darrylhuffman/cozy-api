import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { TriggerSelector } from "./trigger-selector"
import type { WorkflowFile } from "@/lib/api"

const baseStoreReset = () => {
  useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
}

function setWorkflow(wf: WorkflowFile | null) {
  useLiveWorkflowStore.setState({ workflow: wf } as never)
}

describe("TriggerSelector default bodyKind", () => {
  beforeEach(baseStoreReset)
  afterEach(() => {
    cleanup()
    baseStoreReset()
    setWorkflow(null)
  })

  it("single POST trigger → bodyKind='json'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
  })

  it("single PUT trigger → bodyKind='json'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "PUT", path: "/u/1" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
  })

  it("single PATCH trigger → bodyKind='json'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "PATCH", path: "/u/1" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
  })

  it("single GET trigger → bodyKind='none'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "GET", path: "/u" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("none")
  })

  it("single DELETE trigger → bodyKind='none'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "DELETE", path: "/u/1" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("none")
  })

  it("POST trigger sets Content-Type to application/json", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "POST", path: "/u" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    const headers = useDebugSessionStore.getState().requestForm.headers
    expect(headers).toContainEqual(["Content-Type", "application/json"])
  })

  it("GET trigger has empty headers", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "GET", path: "/u" } },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.headers).toEqual([])
  })

  it("trigger list becomes empty → bodyKind resets to 'none'", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "POST", path: "/u" } },
      },
    } as unknown as WorkflowFile)
    const { rerender } = render(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
    setWorkflow({ lorien: 1, nodes: {} } as unknown as WorkflowFile)
    rerender(<TriggerSelector />)
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("none")
  })

  it("renders the picker even when there's only one trigger", () => {
    setWorkflow({
      lorien: 1,
      nodes: {
        req: { uses: "@core/http-request", values: { method: "POST", path: "/u" } },
      },
    } as unknown as WorkflowFile)
    const { container } = render(<TriggerSelector />)
    // shadcn Select renders a button trigger with role "combobox"
    expect(container.querySelector('[role="combobox"]')).toBeTruthy()
  })
})
