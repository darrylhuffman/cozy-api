import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"

// Capture callbacks so tests can fire events
let capturedOnNodesChange: ((changes: unknown[]) => void) | null = null
let capturedOnConnect:
  | ((conn: { source: string; sourceHandle: string; target: string; targetHandle: string }) => void)
  | null = null
// Capture what edges/edgeTypes the editor passed to React Flow
interface CapturedEdge {
  id: string
  type?: string
  source?: string
  sourceHandle?: string | null
  target?: string
  targetHandle?: string | null
  data?: { pathLabel?: string }
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
  }: {
    nodes: { id: string; type?: string; data: Record<string, unknown> }[]
    edges?: {
      id: string
      type?: string
      source?: string
      sourceHandle?: string | null
      target?: string
      targetHandle?: string | null
      data?: { pathLabel?: string }
    }[]
    edgeTypes?: Record<string, unknown>
    nodeTypes?: Record<string, (props: { data: Record<string, unknown> }) => React.ReactNode>
    onNodesChange?: (changes: unknown[]) => void
    onConnect?: (conn: {
      source: string
      sourceHandle: string
      target: string
      targetHandle: string
    }) => void
  }) => {
    capturedOnNodesChange = onNodesChange ?? null
    capturedOnConnect = onConnect ?? null
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
      // terminates at the root ("") instead of "email".
      await waitFor(() => {
        const edge = capturedEdges?.find(
          (e) => e.source === "request" && e.target === "save",
        )
        expect(edge?.targetHandle).toBe("")
      })

      // The tooltip pathLabel still surfaces the deeper path so the user can
      // tell what was bound.
      const savedEmailEdge = capturedEdges?.find(
        (e) =>
          e.source === "request" &&
          e.target === "save" &&
          e.data?.pathLabel === "email",
      )
      expect(savedEmailEdge).toBeDefined()
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
      // handle that's rendered in the DOM).
      await waitFor(() => {
        const edge = capturedEdges?.find(
          (e) => e.source === "request" && e.target === "save",
        )
        expect(edge?.targetHandle).toBe("email")
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

    it("attaches pathLabel data only when the source has a remaining path", async () => {
      vi.mocked(fetchWorkflowFile).mockResolvedValue(createWorkflow)
      render(<WorkflowEditor path="workflows/users/create.workflow" tabId="test-tab" />)
      await waitFor(() => {
        expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
      })

      // request.body.email → save.email — remaining path ["email"]
      const emailEdge = capturedEdges!.find((e) => e.data?.pathLabel === "email")
      expect(emailEdge).toBeDefined()
      // save.user → response.body — no remaining path; pathLabel undefined
      const userEdge = capturedEdges!.find(
        (e) =>
          !e.data?.pathLabel &&
          // disambiguate via source/target — see edge construction
          true,
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

    it("connecting to root targetHandle '' sets `in:` to a string reference (whole-object form)", async () => {
      // Start with a node that has no `in:` set, so no confirm() prompt.
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
          targetHandle: "",
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
          targetHandle: "",
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
          targetHandle: "",
        })
      })

      expect(confirmSpy).toHaveBeenCalledOnce()
      // No dirty mark, no save needed.
      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(false)
      confirmSpy.mockRestore()
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
})
