import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"

// Mock API module
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    fetchWorkflowFile: vi.fn(),
    fetchWorkspaceSchemas: vi.fn().mockResolvedValue({}),
  }
})

// Mock events module — SSE isn't available in jsdom
vi.mock("@/lib/events", () => ({
  subscribeToFileEvents: vi.fn(() => () => {}),
}))

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

import { fetchWorkflowFile, fetchWorkspaceSchemas } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
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
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
  useSelectionStore.setState({ selectedNodeId: null })
}

beforeEach(() => {
  vi.mocked(fetchWorkflowFile).mockResolvedValue(sampleWorkflow)
  vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({})
  vi.mocked(subscribeToFileEvents).mockReturnValue(() => {})
  resetStores()
  // Open a workflow tab
  useTabsStore.getState().openTab({
    id: "tab-1",
    title: "create.workflow",
    kind: "workflow",
    path: "workflows/users/create.workflow",
  })
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

  it("subscribes to SSE file events on mount and unsubscribes on unmount", async () => {
    const unsub = vi.fn()
    vi.mocked(subscribeToFileEvents).mockReturnValue(unsub)
    useSelectionStore.setState({ selectedNodeId: "save" })

    const { unmount } = render(<InspectorPanel />)
    await waitFor(() => {
      expect(subscribeToFileEvents).toHaveBeenCalledOnce()
    })

    unmount()
    expect(unsub).toHaveBeenCalledOnce()
  })

  it("shows empty state when no workflow tab is active", async () => {
    // Remove tabs / active workflow
    useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
    useSelectionStore.setState({ selectedNodeId: "save" })

    render(<InspectorPanel />)
    // Without a path, workflow stays null → instance will be undefined → not-found or empty
    // The node id IS set, but no workflow path exists → node not found message
    await waitFor(() => {
      expect(
        screen.getByText(/save.*not found/i),
      ).toBeInTheDocument()
    })
  })
})
