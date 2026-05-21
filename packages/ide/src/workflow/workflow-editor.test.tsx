import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"

// Capture onNodesChange so tests can fire drag events
let capturedOnNodesChange: ((changes: unknown[]) => void) | null = null

// Mock @xyflow/react — the actual library uses ResizeObserver + canvas APIs
// that aren't available in jsdom. We replace with minimal stubs.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    onNodesChange,
  }: {
    nodes: { id: string }[]
    onNodesChange?: (changes: unknown[]) => void
  }) => {
    capturedOnNodesChange = onNodesChange ?? null
    return (
      <div data-testid="react-flow" data-nodecount={nodes.length}>
        {nodes.map((n) => (
          <div key={n.id} data-testid={`rf-node-${n.id}`} />
        ))}
      </div>
    )
  },
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  applyNodeChanges: (
    changes: { type: string; id: string; position?: { x: number; y: number } }[],
    nodes: { id: string; position: { x: number; y: number } }[],
  ) => {
    // Minimal implementation: apply position changes
    return nodes.map((n) => {
      const change = changes.find((c) => c.type === "position" && c.id === n.id)
      if (change?.position) return { ...n, position: change.position }
      return n
    })
  },
}))

// Mock the CSS import from @xyflow/react
vi.mock("@xyflow/react/dist/style.css", () => ({}))

// Mock fetchWorkflowFile and saveFile
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    fetchWorkflowFile: vi.fn(),
    saveFile: vi.fn().mockResolvedValue({ path: "workflows/users/create.workflow", bytes: 100 }),
  }
})

// Mock events module — SSE isn't available in jsdom
vi.mock("@/lib/events", () => ({
  subscribeToFileEvents: vi.fn(() => () => {}),
}))

import { fetchWorkflowFile, saveFile } from "@/lib/api"
import { useTabsStore } from "@/store/tabs"
import { useThemeStore } from "@/store/theme"
import { WorkflowEditor } from "./workflow-editor.js"

const sampleWorkflow: WorkflowFile = {
  lorien: 1,
  nodes: {
    parseBody: { uses: "@core/parse-body" },
    validate: { uses: "./validateEmail", in: { email: "parseBody.body.email" } },
    save: { uses: "./saveUser", in: { data: "validate" } },
  },
  view: {
    parseBody: { x: 40, y: 40 },
    validate: { x: 300, y: 40 },
    save: { x: 560, y: 40 },
  },
}

function resetStore() {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
}

beforeEach(() => {
  capturedOnNodesChange = null
  useThemeStore.setState({ theme: "light" })
  vi.mocked(fetchWorkflowFile).mockResolvedValue(sampleWorkflow)
  vi.mocked(saveFile).mockResolvedValue({ path: "workflows/users/create.workflow", bytes: 100 })
  resetStore()
  // Open a workflow tab so tabId is valid in the store
  useTabsStore.getState().openTab({
    id: "test-tab",
    title: "create.workflow",
    kind: "workflow",
    path: "workflows/users/create.workflow",
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  resetStore()
})

describe("WorkflowEditor", () => {
  it("shows a loading state while fetching", () => {
    // Don't resolve yet
    vi.mocked(fetchWorkflowFile).mockReturnValue(new Promise(() => {}))
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it("renders React Flow with one node per workflow node after fetch", async () => {
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
    // Wait until all 3 nodes are rendered (two async effects: fetch → workflow, then workflow → nodes)
    await waitFor(() => {
      expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
    })
    expect(screen.getByTestId("rf-node-parseBody")).toBeInTheDocument()
    expect(screen.getByTestId("rf-node-validate")).toBeInTheDocument()
    expect(screen.getByTestId("rf-node-save")).toBeInTheDocument()
  })

  it("shows an error state when fetch fails", async () => {
    vi.mocked(fetchWorkflowFile).mockRejectedValue(new Error("Network error"))
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
    await waitFor(() => {
      expect(screen.getByText(/error loading workflow/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })

  it("re-fetches when path changes", async () => {
    const { rerender } = render(
      <WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />,
    )
    await waitFor(() => screen.getByTestId("react-flow"))
    expect(vi.mocked(fetchWorkflowFile)).toHaveBeenCalledWith("workflows/users/create.workflow")

    rerender(<WorkflowEditor path="workflows/auth/login.workflow" tabId="test-tab" />)
    await waitFor(() => {
      expect(vi.mocked(fetchWorkflowFile)).toHaveBeenCalledWith("workflows/auth/login.workflow")
    })
  })

  it("dragging a node sets dirty flag — does NOT autosave", async () => {
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
    await waitFor(() => screen.getByTestId("react-flow"))

    // Fire a drag-end position change
    act(() => {
      capturedOnNodesChange?.([
        { type: "position", id: "parseBody", dragging: false, position: { x: 100, y: 200 } },
      ])
    })

    // saveFile must NOT have been called
    expect(vi.mocked(saveFile)).not.toHaveBeenCalled()

    // Tab should be dirty in the store
    const tab = useTabsStore.getState().tabs.find((t) => t.id === "test-tab")
    expect(tab?.dirty).toBe(true)

    // Dirty hint appears in the UI
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
  })

  it("Ctrl+S triggers save and clears dirty", async () => {
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
    await waitFor(() => screen.getByTestId("react-flow"))

    // Drag a node to make it dirty
    act(() => {
      capturedOnNodesChange?.([
        { type: "position", id: "parseBody", dragging: false, position: { x: 150, y: 250 } },
      ])
    })

    expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(true)

    // Press Ctrl+S
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true })
    })

    await waitFor(() => {
      expect(vi.mocked(saveFile)).toHaveBeenCalledOnce()
    })

    // Verify the saved content has the updated positions
    const [savedPath, savedContent] = vi.mocked(saveFile).mock.calls[0]!
    expect(savedPath).toBe("workflows/users/create.workflow")
    const parsed = JSON.parse(savedContent) as WorkflowFile
    expect(parsed.view?.parseBody).toEqual({ x: 150, y: 250 })

    // Dirty clears after save
    await waitFor(() => {
      const tab = useTabsStore.getState().tabs.find((t) => t.id === "test-tab")
      expect(tab?.dirty).toBe(false)
    })
  })

  it("multiple drags before Ctrl+S result in a single save", async () => {
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
    await waitFor(() => screen.getByTestId("react-flow"))

    // Multiple drags
    act(() => {
      capturedOnNodesChange?.([
        { type: "position", id: "parseBody", dragging: false, position: { x: 10, y: 20 } },
      ])
    })
    act(() => {
      capturedOnNodesChange?.([
        { type: "position", id: "validate", dragging: false, position: { x: 200, y: 30 } },
      ])
    })
    act(() => {
      capturedOnNodesChange?.([
        { type: "position", id: "save", dragging: false, position: { x: 400, y: 30 } },
      ])
    })

    expect(vi.mocked(saveFile)).not.toHaveBeenCalled()

    // Single Ctrl+S
    await act(async () => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true })
    })

    await waitFor(() => {
      expect(vi.mocked(saveFile)).toHaveBeenCalledOnce()
    })
  })

  it("shows Saving… → Saved status after Ctrl+S", async () => {
    // Delay save resolution so we can catch the "Saving…" state
    let resolveSave!: () => void
    vi.mocked(saveFile).mockImplementation(
      () =>
        new Promise<{ path: string; bytes: number }>((res) => {
          resolveSave = () => res({ path: "workflows/users/create.workflow", bytes: 100 })
        }),
    )

    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
    await waitFor(() => screen.getByTestId("react-flow"))

    // Make it dirty first
    act(() => {
      capturedOnNodesChange?.([
        { type: "position", id: "parseBody", dragging: false, position: { x: 10, y: 20 } },
      ])
    })

    // Trigger Ctrl+S
    act(() => {
      fireEvent.keyDown(window, { key: "s", ctrlKey: true })
    })

    await waitFor(() => expect(screen.getByText("Saving…")).toBeInTheDocument())

    // Resolve the save
    await act(async () => {
      resolveSave()
    })

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
  })
})
