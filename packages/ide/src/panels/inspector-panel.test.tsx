import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"

// Mock API module
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    fetchWorkspaceSchemas: vi.fn().mockResolvedValue({}),
  }
})

// Mock shadcn Tabs components inline so they render in jsdom without portals
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children, defaultValue }: { children: React.ReactNode; defaultValue?: string }) => (
    <div data-testid="tabs" data-defaultvalue={defaultValue}>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tabs-list">{children}</div>
  ),
  TabsTrigger: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <button data-testid={`trigger-${value}`}>{children}</button>
  ),
  TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <div data-testid={`content-${value}`}>{children}</div>
  ),
}))

import { fetchWorkspaceSchemas } from "@/lib/api"
import { useSelectionStore } from "@/store/selection"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { InspectorPanel } from "./inspector-panel"

const sampleWorkflow: WorkflowFile = {
  lorien: 1,
  nodes: {
    save: {
      uses: "./nodes/save-user",
      config: { mode: "upsert" },
    },
    response: {
      uses: "@core/response",
      in: { body: "save.user" },
    },
  },
}

function resetStores() {
  useSelectionStore.setState({ selectedNodeId: null })
  useLiveWorkflowStore.setState({ workflow: null, tabId: null })
}

beforeEach(() => {
  vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({})
  resetStores()
  // Seed the live workflow store (simulating the editor publishing its state)
  useLiveWorkflowStore.setState({ workflow: sampleWorkflow, tabId: "tab-1" })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetStores()
})

describe("InspectorPanel — InspectContent", () => {
  it("shows empty state when no node is selected", async () => {
    useSelectionStore.setState({ selectedNodeId: null })
    render(<InspectorPanel />)
    await waitFor(() => {
      expect(screen.getByText("No node selected.")).toBeInTheDocument()
    })
  })

  it("renders node id, uses, inputs, outputs, and config when a node is selected", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": {
        inputs: {
          type: "object",
          properties: {
            email: { type: "string" },
            password: { type: "string" },
          },
        },
        outputs: {
          type: "object",
          properties: {
            user: { type: "object" },
          },
        },
      },
    })
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    // Wait for async fetch to resolve
    await waitFor(() => {
      expect(screen.getByText("save")).toBeInTheDocument()
    })

    // Node section
    expect(screen.getByText("./nodes/save-user")).toBeInTheDocument()

    // Inputs section — schema fields
    expect(screen.getByText("email")).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()

    // Outputs section — schema fields
    expect(screen.getByText("user")).toBeInTheDocument()

    // Config section — JSON config
    expect(screen.getByText(/"mode"/)).toBeInTheDocument()
    expect(screen.getByText(/"upsert"/)).toBeInTheDocument()
  })

  it("renders a color swatch when schemas[uses].color is set", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": {
        inputs: { type: "object", properties: {} },
        outputs: { type: "object", properties: {} },
        color: "#3b82f6",
      },
    })
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    await waitFor(() => {
      // The color text label appears next to the swatch
      expect(screen.getByText("#3b82f6")).toBeInTheDocument()
    })

    // The swatch span has the background style set
    const swatch = document.querySelector<HTMLElement>('[style*="background"]')
    expect(swatch).not.toBeNull()
    // jsdom normalises hex to rgb — just verify an inline style exists
    expect(swatch?.style.background).toBeTruthy()
  })

  it("shows not-found state when selectedId has no matching node in the workflow", async () => {
    useSelectionStore.setState({ selectedNodeId: "ghost" })
    render(<InspectorPanel />)
    await waitFor(() => {
      expect(screen.getByText(/ghost.*not found/i)).toBeInTheDocument()
    })
  })

  it("shows (none) for config when node.config is absent", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "@core/response": {
        inputs: { type: "object", properties: {} },
        outputs: { type: "object", properties: {} },
      },
    })
    useSelectionStore.setState({ selectedNodeId: "response" })
    render(<InspectorPanel />)
    await waitFor(() => {
      expect(screen.getByText("(none)")).toBeInTheDocument()
    })
  })

  it("shows empty state when no workflow tab is active (live store is null)", async () => {
    // Clear the live workflow store — simulates no active editor tab
    useLiveWorkflowStore.setState({ workflow: null, tabId: null })
    useSelectionStore.setState({ selectedNodeId: "save" })

    render(<InspectorPanel />)
    // No workflow in store → node not found
    await waitFor(() => {
      expect(screen.getByText(/save.*not found/i)).toBeInTheDocument()
    })
  })

  it("renders a newly-added in-memory node that has never been saved to disk", async () => {
    // This is the bug regression test: a node added via Ctrl+K/right-click/drag
    // lives only in the editor's in-memory state. The inspector must see it
    // immediately without waiting for a Ctrl+S save.
    const workflowWithNewNode: WorkflowFile = {
      lorien: 1,
      nodes: {
        ...sampleWorkflow.nodes,
        "http-request": {
          uses: "@core/http-request",
          config: { path: "/api/data", method: "GET" },
        },
      },
    }
    // Simulate the editor publishing the updated in-memory workflow
    useLiveWorkflowStore.setState({ workflow: workflowWithNewNode, tabId: "tab-1" })

    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "@core/http-request": {
        inputs: { type: "object", properties: {} },
        outputs: {
          type: "object",
          properties: { body: { type: "object" } },
        },
      },
    })

    // User clicks the newly-added node
    useSelectionStore.setState({ selectedNodeId: "http-request" })
    render(<InspectorPanel />)

    // Inspector should show the node details, NOT the "not found" error
    await waitFor(() => {
      expect(screen.getByText("http-request")).toBeInTheDocument()
    })
    expect(screen.getByText("@core/http-request")).toBeInTheDocument()
    // The config block should be rendered
    expect(screen.getByText(/\/api\/data/)).toBeInTheDocument()
    // "not found" error must NOT appear
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
  })
})
