import { afterEach, describe, expect, it } from "vitest"
import type { WorkflowFile } from "@/lib/api"
import { useLiveWorkflowStore } from "./live-workflow"

const sampleWorkflow: WorkflowFile = {
  lorien: 1,
  nodes: {
    save: { uses: "./nodes/save-user", config: { mode: "upsert" } },
  },
}

afterEach(() => {
  useLiveWorkflowStore.setState({ workflow: null, tabId: null })
})

describe("useLiveWorkflowStore", () => {
  it("starts with null workflow and null tabId", () => {
    const state = useLiveWorkflowStore.getState()
    expect(state.workflow).toBeNull()
    expect(state.tabId).toBeNull()
  })

  it("setLiveWorkflow stores both tabId and workflow", () => {
    useLiveWorkflowStore.getState().setLiveWorkflow("tab-1", sampleWorkflow)
    const state = useLiveWorkflowStore.getState()
    expect(state.tabId).toBe("tab-1")
    expect(state.workflow).toBe(sampleWorkflow)
  })

  it("clearIfTab clears state when tabId matches", () => {
    useLiveWorkflowStore.getState().setLiveWorkflow("tab-1", sampleWorkflow)
    useLiveWorkflowStore.getState().clearIfTab("tab-1")
    const state = useLiveWorkflowStore.getState()
    expect(state.workflow).toBeNull()
    expect(state.tabId).toBeNull()
  })

  it("clearIfTab is a no-op when tabId does not match", () => {
    useLiveWorkflowStore.getState().setLiveWorkflow("tab-1", sampleWorkflow)
    useLiveWorkflowStore.getState().clearIfTab("tab-99")
    const state = useLiveWorkflowStore.getState()
    expect(state.tabId).toBe("tab-1")
    expect(state.workflow).toBe(sampleWorkflow)
  })
})
