import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"

// Capture callbacks so tests can fire events
let capturedOnNodesChange: ((changes: unknown[]) => void) | null = null
let capturedOnConnect:
  | ((conn: { source: string; sourceHandle: string; target: string; targetHandle: string }) => void)
  | null = null
let capturedOnNodesDelete: ((deleted: { id: string }[]) => void) | null = null
let capturedOnEdgesDelete: ((deleted: CapturedEdge[]) => void) | null = null
let capturedOnReconnectEnd:
  | ((event: unknown, edge: CapturedEdge, handleType: unknown, connectionState: unknown) => void)
  | null = null
let capturedOnNodeClick:
  | ((event: unknown, node: { id: string }) => void)
  | null = null
let capturedOnPaneClick: (() => void) | null = null
let capturedOnNodeContextMenu:
  | ((event: { preventDefault: () => void; clientX: number; clientY: number }, node: { id: string }) => void)
  | null = null
// Capture what edges/edgeTypes the editor passed to React Flow
interface CapturedMapping {
  source: string
  target: string
}
interface CapturedEdge {
  id: string
  type?: string
  source?: string
  sourceHandle?: string | null
  target?: string
  targetHandle?: string | null
  data?: { mappings?: CapturedMapping[] }
}
let capturedEdges: CapturedEdge[] | null = null
let capturedEdgeTypes: Record<string, unknown> | null = null
// Capture last-rendered node data so we can poke at expandedInputs/outputs etc.
let capturedNodes:
  | { id: string; type?: string; data: Record<string, unknown> }[]
  | null = null

// Mock @xyflow/react — the actual library uses ResizeObserver + canvas APIs
// that aren't available in jsdom. We replace with minimal stubs.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({
    nodes,
    edges,
    edgeTypes,
    nodeTypes,
    onNodesChange,
    onConnect,
    onNodesDelete,
    onEdgesDelete,
    onReconnectEnd,
    onNodeClick,
    onPaneClick,
    onNodeContextMenu,
  }: {
    nodes: { id: string; type?: string; data: Record<string, unknown> }[]
    edges?: CapturedEdge[]
    edgeTypes?: Record<string, unknown>
    nodeTypes?: Record<string, (props: { data: Record<string, unknown> }) => React.ReactNode>
    onNodesChange?: (changes: unknown[]) => void
    onConnect?: (conn: {
      source: string
      sourceHandle: string
      target: string
      targetHandle: string
    }) => void
    onNodesDelete?: (deleted: { id: string }[]) => void
    onEdgesDelete?: (deleted: CapturedEdge[]) => void
    onReconnectEnd?: (event: unknown, edge: CapturedEdge, handleType: unknown, connectionState: unknown) => void
    onNodeClick?: (event: unknown, node: { id: string }) => void
    onPaneClick?: () => void
    onNodeContextMenu?: (event: { preventDefault: () => void; clientX: number; clientY: number }, node: { id: string }) => void
  }) => {
    capturedOnNodesChange = onNodesChange ?? null
    capturedOnConnect = onConnect ?? null
    capturedOnNodesDelete = onNodesDelete ?? null
    capturedOnEdgesDelete = onEdgesDelete ?? null
    capturedOnReconnectEnd = onReconnectEnd ?? null
    capturedOnNodeClick = onNodeClick ?? null
    capturedOnPaneClick = onPaneClick ?? null
    capturedOnNodeContextMenu = onNodeContextMenu ?? null
    capturedEdges = edges ?? null
    capturedEdgeTypes = edgeTypes ?? null
    capturedNodes = nodes ?? null
    return (
      <div
        data-testid="react-flow"
        data-nodecount={nodes.length}
        data-edgecount={edges?.length ?? 0}
      >
        {nodes.map((n) => {
          const NodeComponent = n.type && nodeTypes?.[n.type]
          return (
            <div key={n.id} data-testid={`rf-node-${n.id}`}>
              {NodeComponent ? <NodeComponent data={n.data} /> : null}
            </div>
          )
        })}
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

// Mock NodeContextMenu to avoid Popover portal issues in jsdom
let capturedNodeMenuProps: {
  open: boolean
  onOpenChange: (o: boolean) => void
  x: number
  y: number
  onDelete: () => void
  onReset: () => void
} | null = null

vi.mock("./node-context-menu", () => ({
  NodeContextMenu: (props: {
    open: boolean
    onOpenChange: (o: boolean) => void
    x: number
    y: number
    onDelete: () => void
    onReset: () => void
  }) => {
    capturedNodeMenuProps = props
    if (!props.open) return null
    return (
      <div data-testid="node-context-menu">
        <button type="button" onClick={props.onReset}>
          Reset connections
        </button>
        <button type="button" onClick={props.onDelete}>
          Delete node
        </button>
      </div>
    )
  },
}))

// Mock fetchWorkflowFile, fetchWorkspaceSchemas, and saveFile
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    fetchWorkflowFile: vi.fn(),
    fetchWorkspaceSchemas: vi.fn().mockResolvedValue({}),
    saveFile: vi.fn().mockResolvedValue({ path: "workflows/users/create.workflow", bytes: 100 }),
  }
})

// Mock events module — SSE isn't available in jsdom
vi.mock("@/lib/events", () => ({
  subscribeToFileEvents: vi.fn(() => () => {}),
}))

import { fetchWorkflowFile, fetchWorkspaceSchemas, saveFile } from "@/lib/api"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import { useThemeStore } from "@/store/theme"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { defaultPathForWorkflow, WorkflowEditor } from "./workflow-editor.js"

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

/** Mirrors the basic-api create.workflow fixture for port-label tests. */
const createWorkflow: WorkflowFile = {
  lorien: 1,
  nodes: {
    request: {
      uses: "@core/http-request",
      config: { path: "/users", method: "POST" },
    },
    save: {
      uses: "./nodes/users/save-user",
      in: {
        email: "request.body.email",
        password: "request.body.password",
      },
    },
    response: {
      uses: "@core/response",
      in: {
        body: "save.user",
        status: 201,
      },
    },
  },
}

function resetStore() {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
}

beforeEach(() => {
  capturedOnNodesChange = null
  capturedOnConnect = null
  capturedOnNodesDelete = null
  capturedOnEdgesDelete = null
  capturedOnReconnectEnd = null
  capturedOnNodeClick = null
  capturedOnPaneClick = null
  capturedOnNodeContextMenu = null
  capturedNodeMenuProps = null
  capturedEdges = null
  capturedEdgeTypes = null
  capturedNodes = null
  useThemeStore.setState({ theme: "light" })
  vi.mocked(fetchWorkflowFile).mockResolvedValue(sampleWorkflow)
  vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({})
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
  useSelectionStore.setState({ selectedNodeId: null })
  useLiveWorkflowStore.setState({ workflow: null, tabId: null })
})

describe("defaultPathForWorkflow", () => {
  it('strips "workflows/" prefix, ".workflow" suffix, and drops create verb', () => {
    expect(defaultPathForWorkflow("workflows/users/create.workflow")).toBe("/users")
  })
  it("drops list verb", () => {
    expect(defaultPathForWorkflow("workflows/posts/list.workflow")).toBe("/posts")
  })
  it("keeps single non-verb segment", () => {
    expect(defaultPathForWorkflow("workflows/health.workflow")).toBe("/health")
  })
  it("preserves multi-segment non-verb path", () => {
    expect(defaultPathForWorkflow("workflows/admin/users/delete.workflow")).toBe("/admin/users")
  })
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

  it("renders unified root input port + named output ports on nodes from create.workflow", async () => {
    vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
    render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)

    // Wait until the 3 nodes are rendered
    await waitFor(() => {
      expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
    })

    // The save node shows a single root input port labeled "input" — children
    // (email/password) live behind the root chevron and only render when expanded.
    const saveNodeEl = screen.getByTestId("rf-node-save")
    expect(saveNodeEl.textContent).toContain("input")
    expect(saveNodeEl.textContent).not.toContain("email")
    expect(saveNodeEl.textContent).not.toContain("password")

    // The save node should also show its output port: "user"
    expect(saveNodeEl).toContainElement(screen.getByText("user"))

    // The request node should show its output port: "body"
    const requestNodeEl = screen.getByTestId("rf-node-request")
    expect(requestNodeEl.textContent).toContain("body")

    // The response node also has a unified "input" root
    const responseNodeEl = screen.getByTestId("rf-node-response")
    expect(responseNodeEl.textContent).toContain("input")

    // The request node (trigger) has no inputs at all — no "input" label
    expect(requestNodeEl.textContent).not.toContain("input")
  })

  describe("edge routing & expansion state", () => {
    it("re-routes edges to the visible parent when target inputs collapse", async () => {
      // Provide a schema so `save` gets a non-trivial inputs tree (email/password
      // as top-level fields of the input root). `save.in` is fully satisfied, so
      // the editor's initial expansion seeds the inputs as COLLAPSED.
      vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
        "./nodes/users/save-user": {
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
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                },
              },
            },
          },
        },
      })
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)

      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // After schemas resolve, edges should be re-routed. The reference
      // request.body.email → save.email has its target collapsed (because
      // save's inputs are fully satisfied → root not expanded) so the edge
      // terminates at the root ("") instead of "email". Both email AND
      // password collapse to the same (request.body, save.input) edge — and
      // since both source-side handles also collapse onto the same point
      // (sourceHandle "body"), the editor MERGES them into one visual edge.
      await waitFor(() => {
        const edges = capturedEdges?.filter(
          (e) => e.source === "request" && e.target === "save",
        )
        expect(edges?.length).toBe(1)
        // Root input handle is rendered as "$root" so React Flow can form the connection.
        expect(edges?.[0]?.targetHandle).toBe("$root")
      })

      // The merged edge carries BOTH underlying mappings so the hover card
      // can render one table row per binding.
      const merged = capturedEdges?.find(
        (e) => e.source === "request" && e.target === "save",
      )
      expect(merged?.data?.mappings).toEqual([
        { source: "request.body.email", target: "save.email" },
        { source: "request.body.password", target: "save.password" },
      ])
    })

    it("routes through to the leaf when the input is expanded", async () => {
      // Same schemas, but `save` has only one field bound — so its input root
      // starts EXPANDED ("partial satisfaction").
      vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
        "./nodes/users/save-user": {
          inputs: {
            type: "object",
            properties: {
              email: { type: "string" },
              password: { type: "string" },
            },
          },
          outputs: { type: "object", properties: {} },
        },
      })
      const partial: WorkflowFile = {
        ...createWorkflow,
        nodes: {
          ...createWorkflow.nodes,
          save: {
            uses: "./nodes/users/save-user",
            in: { email: "request.body.email" },
          },
        },
      }
      vi.mocked(fetchWorkflowFile).mockResolvedValue(partial)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)

      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // With root expanded, the edge terminates at "email" (the actual leaf
      // handle that's rendered in the DOM).  Only one binding exists in this
      // partial workflow, so there's a single edge with one mapping.
      await waitFor(() => {
        const edge = capturedEdges?.find(
          (e) => e.source === "request" && e.target === "save",
        )
        expect(edge?.targetHandle).toBe("email")
        expect(edge?.data?.mappings).toEqual([
          { source: "request.body.email", target: "save.email" },
        ])
      })
    })

    it("threads color from schemas through to node data (accent stripe)", async () => {
      vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
        "@core/http-request": {
          inputs: { type: "object", properties: {} },
          outputs: { type: "object", properties: { body: { type: "object" } } },
          color: "#3b82f6",
        },
        "./nodes/users/save-user": {
          inputs: { type: "object", properties: { email: { type: "string" } } },
          outputs: { type: "object", properties: {} },
          color: "indigo",
        },
      })
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      await waitFor(() => {
        const requestNode = capturedNodes?.find((n) => n.id === "request")
        expect(requestNode?.data.color).toBe("#3b82f6")
        const saveNode = capturedNodes?.find((n) => n.id === "save")
        expect(saveNode?.data.color).toBe("indigo")
      })
    })
  })

  describe("edges with PathEdge (hover-dot labels)", () => {
    it("registers `path` in edgeTypes and emits edges with type='path'", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // edgeTypes carries the `path` entry
      expect(capturedEdgeTypes).not.toBeNull()
      expect(capturedEdgeTypes).toHaveProperty("path")

      // Each emitted edge has type = "path"
      expect(capturedEdges).not.toBeNull()
      expect(capturedEdges!.length).toBeGreaterThan(0)
      for (const edge of capturedEdges ?? []) {
        expect(edge.type).toBe("path")
      }
    })

    it("emits a single mapping with no target suffix for whole-object `in: \"...\"` form", async () => {
      const wholeObject: WorkflowFile = {
        ...createWorkflow,
        nodes: {
          ...createWorkflow.nodes,
          save: { uses: "./nodes/users/save-user", in: "request.body" },
        },
      }
      vi.mocked(fetchWorkflowFile).mockResolvedValue(wholeObject)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      await waitFor(() => {
        const edges = capturedEdges?.filter(
          (e) => e.source === "request" && e.target === "save",
        )
        expect(edges?.length).toBe(1)
        expect(edges?.[0]?.data?.mappings).toEqual([
          { source: "request.body", target: "save" },
        ])
      })
    })

    it("attaches mappings carrying the full source and target paths", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // request.body.email → save.email — full path is "request.body.email"
      const emailEdge = capturedEdges!.find((e) =>
        e.data?.mappings?.some(
          (m) => m.source === "request.body.email" && m.target === "save.email",
        ),
      )
      expect(emailEdge).toBeDefined()
      // save.user → response.body — full path is "save.user"
      const userEdge = capturedEdges!.find((e) =>
        e.data?.mappings?.some(
          (m) => m.source === "save.user" && m.target === "response.body",
        ),
      )
      expect(userEdge).toBeDefined()
    })
  })

  describe("drag-to-connect (onConnect)", () => {
    it("updates the target node's in: block with a reference string", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Simulate dragging from request.body.email -> save.email (which is
      // already set to that, so this should be a no-op overwrite). Then
      // override to a new value to prove the update lands.
      act(() => {
        capturedOnConnect?.({
          source: "save",
          sourceHandle: "user.id",
          target: "response",
          targetHandle: "body",
        })
      })

      // Save by Ctrl+S — the saved JSON should reflect the new reference
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => {
        expect(vi.mocked(saveFile)).toHaveBeenCalledOnce()
      })

      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile
      const responseIn = parsed.nodes.response!.in as Record<string, unknown>
      expect(responseIn.body).toBe("save.user.id")
    })

    it("marks the tab dirty after a connect", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(false)

      act(() => {
        capturedOnConnect?.({
          source: "request",
          sourceHandle: "body.email",
          target: "save",
          targetHandle: "email",
        })
      })

      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(true)
      expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument()
    })

    it("ignores connects with missing handles", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Missing sourceHandle → no-op
      act(() => {
        capturedOnConnect?.({
          source: "request",
          sourceHandle: "",
          target: "save",
          targetHandle: "email",
        })
      })

      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(false)
    })

    it("connecting to root (targetHandle '$root') sets `in:` to a string reference (whole-object form)", async () => {
      // Start with a node that has no `in:` set, so no confirm() prompt.
      // The root input handle is rendered with id="$root" (ROOT_HANDLE_ID) so
      // React Flow can form the connection — previously "" caused dropped connections.
      const blankSave: WorkflowFile = {
        ...createWorkflow,
        nodes: {
          ...createWorkflow.nodes,
          save: { uses: "./nodes/users/save-user" },
        },
      }
      vi.mocked(fetchWorkflowFile).mockResolvedValue(blankSave)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      act(() => {
        capturedOnConnect?.({
          source: "request",
          sourceHandle: "body",
          target: "save",
          targetHandle: "$root",
        })
      })

      // Save and inspect the persisted JSON
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => expect(vi.mocked(saveFile)).toHaveBeenCalledOnce())
      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile
      expect(parsed.nodes.save!.in).toBe("request.body")
    })

    it("connecting to root replaces per-field `in:` only after window.confirm", async () => {
      // Stub confirm so jsdom doesn't throw on unimplemented dialogs.
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      act(() => {
        capturedOnConnect?.({
          source: "request",
          sourceHandle: "body",
          target: "save",
          targetHandle: "$root",
        })
      })

      expect(confirmSpy).toHaveBeenCalledOnce()
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => expect(vi.mocked(saveFile)).toHaveBeenCalledOnce())
      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile
      // Per-field entries are replaced with the whole-object string
      expect(parsed.nodes.save!.in).toBe("request.body")
      confirmSpy.mockRestore()
    })

    it("denying the confirm() leaves the existing per-field `in:` intact", async () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false)
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      act(() => {
        capturedOnConnect?.({
          source: "request",
          sourceHandle: "body",
          target: "save",
          targetHandle: "$root",
        })
      })

      expect(confirmSpy).toHaveBeenCalledOnce()
      // No dirty mark, no save needed.
      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(false)
      confirmSpy.mockRestore()
    })

    it("BUG REGRESSION: dropping a source onto the collapsed root input creates a whole-object connection", async () => {
      // Reproduces the bug where dragging request.body onto save's collapsed root
      // input produced no connection. Root cause: the Handle was rendered with
      // id="" (empty string), which React Flow rejects for connection events —
      // the fix renders it as id="$root" (ROOT_HANDLE_ID) and onConnect maps
      // "$root" → whole-object form internally.
      const blankSave: WorkflowFile = {
        ...createWorkflow,
        nodes: {
          ...createWorkflow.nodes,
          save: { uses: "./nodes/users/save-user" },
        },
      }
      vi.mocked(fetchWorkflowFile).mockResolvedValue(blankSave)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // React Flow now fires onConnect with targetHandle: "$root" (not "")
      act(() => {
        capturedOnConnect?.({
          source: "request",
          sourceHandle: "body",
          target: "save",
          targetHandle: "$root",
        })
      })

      // Ctrl+S to persist
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => expect(vi.mocked(saveFile)).toHaveBeenCalledOnce())
      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile
      // The whole-object form: `in: "request.body"`
      expect(parsed.nodes.save!.in).toBe("request.body")
    })

    it("per-field connect on a string-form `in:` switches to object form", async () => {
      const stringIn: WorkflowFile = {
        ...createWorkflow,
        nodes: {
          ...createWorkflow.nodes,
          save: { uses: "./nodes/users/save-user", in: "request.body" },
        },
      }
      vi.mocked(fetchWorkflowFile).mockResolvedValue(stringIn)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      act(() => {
        capturedOnConnect?.({
          source: "request",
          sourceHandle: "body.email",
          target: "save",
          targetHandle: "email",
        })
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => expect(vi.mocked(saveFile)).toHaveBeenCalledOnce())
      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile
      // The previous "request.body" whole-object form is dropped in favour of
      // a fresh per-field object containing only the new connection.
      expect(parsed.nodes.save!.in).toEqual({ email: "request.body.email" })
    })

    it("Ctrl+S persists the new in: structure after a connect", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Connect: drag from request.body.email to save.email (already there) and
      // then from save.user to response.body
      act(() => {
        capturedOnConnect?.({
          source: "save",
          sourceHandle: "user.email",
          target: "response",
          targetHandle: "body",
        })
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => {
        expect(vi.mocked(saveFile)).toHaveBeenCalledOnce()
      })

      const [savedPath, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      expect(savedPath).toBe("workflows/users/create.workflow")
      const parsed = JSON.parse(savedContent) as WorkflowFile
      const saveIn = parsed.nodes.save!.in as Record<string, unknown>
      const responseIn = parsed.nodes.response!.in as Record<string, unknown>
      // The other in: entries on save should be preserved
      expect(saveIn.email).toBe("request.body.email")
      expect(saveIn.password).toBe("request.body.password")
      // The response.body should now reference save.user.email
      expect(responseIn.body).toBe("save.user.email")
      // status literal should still be 201
      expect(responseIn.status).toBe(201)

      // After the save, the tab is no longer dirty
      await waitFor(() => {
        const tab = useTabsStore.getState().tabs.find((t) => t.id === "test-tab")
        expect(tab?.dirty).toBe(false)
      })
    })
  })

  describe("drag-from-sidebar drop onto canvas", () => {
    it("dropping a lorien-node payload adds a node at the drop coordinates", async () => {
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      const canvas = screen.getByTestId("react-flow").parentElement!

      // Simulate a drag-drop with the lorien-node MIME type
      const dataTransferMock = {
        types: ["application/lorien-node"],
        getData: vi.fn().mockReturnValue("./nodes/users/save-user"),
        dropEffect: "",
      }

      act(() => {
        fireEvent.dragOver(canvas, { dataTransfer: dataTransferMock, clientX: 250, clientY: 150 })
      })

      act(() => {
        fireEvent.drop(canvas, { dataTransfer: dataTransferMock, clientX: 250, clientY: 150 })
      })

      // A new node should have been added (now 4 nodes)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("4")
      })

      // The tab should be dirty
      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(true)
    })
  })

  describe("delete nodes and edges", () => {
    it("onNodesDelete removes the node from the workflow and cleans up downstream refs", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Delete the "save" node
      act(() => {
        capturedOnNodesDelete?.([{ id: "save" }])
      })

      // Ctrl+S to persist
      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => {
        expect(vi.mocked(saveFile)).toHaveBeenCalledOnce()
      })

      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile

      // "save" node is gone
      expect(parsed.nodes.save).toBeUndefined()
      // response.in.body referenced "save.user" — that ref should be stripped
      const responseIn = parsed.nodes.response?.in as Record<string, unknown>
      expect(responseIn?.body).toBeUndefined()
      // status: 201 literal should remain untouched
      expect(responseIn?.status).toBe(201)
    })

    it("onEdgesDelete removes the edge's mappings from the workflow", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Find an edge with a mapping from request.body.email → save.email
      await waitFor(() => {
        expect(capturedEdges).not.toBeNull()
        const edge = capturedEdges?.find((e) =>
          e.data?.mappings?.some(
            (m) => m.source === "request.body.email" && m.target === "save.email",
          ),
        )
        expect(edge).toBeDefined()
      })

      const edge = capturedEdges!.find((e) =>
        e.data?.mappings?.some(
          (m) => m.source === "request.body.email" && m.target === "save.email",
        ),
      )!

      act(() => {
        capturedOnEdgesDelete?.([edge])
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => {
        expect(vi.mocked(saveFile)).toHaveBeenCalledOnce()
      })

      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile
      const saveIn = parsed.nodes.save?.in as Record<string, unknown>
      // The email mapping was on the same edge as password (merged edge) — both removed
      expect(saveIn?.email).toBeUndefined()
    })

    it("onReconnectEnd with no successful reconnect deletes the edge's mappings", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Find the save→response edge carrying save.user → response.body
      await waitFor(() => {
        expect(capturedEdges).not.toBeNull()
        const edge = capturedEdges?.find((e) =>
          e.data?.mappings?.some(
            (m) => m.source === "save.user" && m.target === "response.body",
          ),
        )
        expect(edge).toBeDefined()
      })

      const edge = capturedEdges!.find((e) =>
        e.data?.mappings?.some(
          (m) => m.source === "save.user" && m.target === "response.body",
        ),
      )!

      // Trigger onReconnectEnd without a prior successful reconnect (reconnectSuccess stays false)
      act(() => {
        capturedOnReconnectEnd?.(
          new MouseEvent("mouseup"),
          edge,
          "target",
          { isValid: null, from: null, fromHandle: null, fromPosition: null, fromNode: null, to: null, toHandle: null, toPosition: null, toNode: null, pointer: null },
        )
      })

      await act(async () => {
        fireEvent.keyDown(window, { key: "s", ctrlKey: true })
      })
      await waitFor(() => {
        expect(vi.mocked(saveFile)).toHaveBeenCalledOnce()
      })

      const [, savedContent] = vi.mocked(saveFile).mock.calls[0]!
      const parsed = JSON.parse(savedContent) as WorkflowFile
      const responseIn = parsed.nodes.response?.in as Record<string, unknown>
      // response.body was referencing save.user — now it should be gone
      expect(responseIn?.body).toBeUndefined()
    })

    it("onNodesDelete clears selection when the deleted node was selected", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Pre-select "save"
      useSelectionStore.setState({ selectedNodeId: "save" })
      expect(useSelectionStore.getState().selectedNodeId).toBe("save")

      // Delete the selected node
      act(() => {
        capturedOnNodesDelete?.([{ id: "save" }])
      })

      // Selection should be cleared
      expect(useSelectionStore.getState().selectedNodeId).toBeNull()
    })
  })

  describe("live-workflow store publishing", () => {
    it("publishes the fetched workflow to the live store after initial load", async () => {
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      const stored = useLiveWorkflowStore.getState()
      expect(stored.tabId).toBe("test-tab")
      expect(stored.workflow).not.toBeNull()
      expect(Object.keys(stored.workflow!.nodes)).toEqual(
        expect.arrayContaining(["parseBody", "validate", "save"]),
      )
    })

    it("publishes to the live store when a node is added via addNodeAt (Ctrl+K / drag-from-sidebar)", async () => {
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      const canvas = screen.getByTestId("react-flow").parentElement!
      const dataTransferMock = {
        types: ["application/lorien-node"],
        getData: vi.fn().mockReturnValue("@core/http-request"),
        dropEffect: "",
      }

      act(() => {
        fireEvent.dragOver(canvas, { dataTransfer: dataTransferMock, clientX: 250, clientY: 150 })
      })
      act(() => {
        fireEvent.drop(canvas, { dataTransfer: dataTransferMock, clientX: 250, clientY: 150 })
      })

      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("4")
      })

      // The live store must now include the newly-added node
      const stored = useLiveWorkflowStore.getState()
      const nodeIds = Object.keys(stored.workflow!.nodes)
      expect(nodeIds.some((id) => stored.workflow!.nodes[id]!.uses === "@core/http-request")).toBe(true)
    })

    it("publishes to the live store after onNodesDelete", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      act(() => {
        capturedOnNodesDelete?.([{ id: "save" }])
      })

      const stored = useLiveWorkflowStore.getState()
      expect(stored.workflow!.nodes.save).toBeUndefined()
    })

    it("clears the live store on unmount", async () => {
      const { unmount } = render(
        <WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />,
      )
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Confirm the store is populated
      expect(useLiveWorkflowStore.getState().workflow).not.toBeNull()

      unmount()

      // After unmount the store should be cleared
      expect(useLiveWorkflowStore.getState().workflow).toBeNull()
      expect(useLiveWorkflowStore.getState().tabId).toBeNull()
    })
  })

  describe("selection wiring (onNodeClick / onPaneClick)", () => {
    it("onNodeClick sets selectedNodeId in the selection store", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      expect(useSelectionStore.getState().selectedNodeId).toBeNull()

      act(() => {
        capturedOnNodeClick?.({}, { id: "save" })
      })

      expect(useSelectionStore.getState().selectedNodeId).toBe("save")
    })

    it("onPaneClick clears selectedNodeId in the selection store", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Pre-select a node
      act(() => {
        capturedOnNodeClick?.({}, { id: "request" })
      })
      expect(useSelectionStore.getState().selectedNodeId).toBe("request")

      // Click the pane → clears selection
      act(() => {
        capturedOnPaneClick?.()
      })
      expect(useSelectionStore.getState().selectedNodeId).toBeNull()
    })
  })

  describe("node context menu (right-click → Delete + Reset connections)", () => {
    it("right-clicking a node opens the context menu with the node's id", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Simulate right-click on the "save" node
      act(() => {
        capturedOnNodeContextMenu?.(
          { preventDefault: vi.fn(), clientX: 150, clientY: 200 },
          { id: "save" },
        )
      })

      // The context menu should open
      await waitFor(() => {
        expect(screen.getByTestId("node-context-menu")).toBeInTheDocument()
      })
      expect(screen.getByText("Reset connections")).toBeInTheDocument()
      expect(screen.getByText("Delete node")).toBeInTheDocument()
    })

    it("clicking Delete node removes the node and marks dirty", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Open context menu for "save"
      act(() => {
        capturedOnNodeContextMenu?.(
          { preventDefault: vi.fn(), clientX: 150, clientY: 200 },
          { id: "save" },
        )
      })

      await waitFor(() => {
        expect(screen.getByTestId("node-context-menu")).toBeInTheDocument()
      })

      // Click Delete node
      act(() => {
        fireEvent.click(screen.getByText("Delete node"))
      })

      // Node count drops to 2 (save is removed)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("2")
      })

      // Tab should be dirty
      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(true)

      // Workflow no longer contains "save"
      expect(useLiveWorkflowStore.getState().workflow?.nodes.save).toBeUndefined()
    })

    it("clicking Reset connections clears in: for the node and strips refs in others", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Open context menu for "save"
      act(() => {
        capturedOnNodeContextMenu?.(
          { preventDefault: vi.fn(), clientX: 150, clientY: 200 },
          { id: "save" },
        )
      })

      await waitFor(() => {
        expect(screen.getByTestId("node-context-menu")).toBeInTheDocument()
      })

      // Click Reset connections
      act(() => {
        fireEvent.click(screen.getByText("Reset connections"))
      })

      // Node count stays at 3 — node was NOT deleted
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // Tab should be dirty
      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(true)

      // save.in should be cleared
      const liveWf = useLiveWorkflowStore.getState().workflow!
      expect(liveWf.nodes.save?.in).toBeUndefined()

      // response.in.body referenced "save.user" — should be stripped
      const responseIn = liveWf.nodes.response?.in as Record<string, unknown>
      expect(responseIn?.body).toBeUndefined()
      // status literal remains
      expect(responseIn?.status).toBe(201)
    })
  })

  describe("inline value editing does not collapse ports (item 2/4 fix)", () => {
    it("editing an input value keeps the port group visible (expandedInputs preserved)", async () => {
      // Set up schemas so http-request has method + path inputs
      const httpSchemas: Record<string, import("@/lib/api").NodeSchemas> = {
        "@core/http-request": {
          inputs: {
            type: "object",
            properties: {
              method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
              path: { type: "string" },
            },
          },
          outputs: { type: "object", properties: { body: { type: "object" } } },
        },
      }
      vi.mocked(fetchWorkspaceSchemas).mockResolvedValue(httpSchemas)

      const wf: WorkflowFile = {
        lorien: 1,
        nodes: {
          req: {
            uses: "@core/http-request",
            in: {},
          },
        },
      }
      vi.mocked(fetchWorkflowFile).mockResolvedValue(wf)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)

      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("1")
      })

      // The req node's method input root should be expanded (no fields bound yet).
      await waitFor(() => {
        const node = capturedNodes?.find((n) => n.id === "req")
        const expanded = node?.data.expandedInputs as Set<string> | undefined
        expect(expanded?.has("")).toBe(true)
      })

      // Simulate onInputValueChange for method="GET" (as if user picked from dropdown)
      const nodeData = capturedNodes?.find((n) => n.id === "req")?.data
      const onInputValueChange = nodeData?.onInputValueChange as
        | ((portId: string, value: unknown) => void)
        | undefined
      expect(onInputValueChange).toBeDefined()

      act(() => {
        onInputValueChange!("method", "GET")
      })

      // After the value change the workflow updates, which re-runs the node-init
      // effect. The expanded root should STILL be in expandedInputs (not reset to
      // empty) because the fix reads from the expansion Map ref.
      await waitFor(() => {
        const updatedNode = capturedNodes?.find((n) => n.id === "req")
        const expanded = updatedNode?.data.expandedInputs as Set<string> | undefined
        expect(expanded?.has("")).toBe(true)
      })
    })
  })
})
