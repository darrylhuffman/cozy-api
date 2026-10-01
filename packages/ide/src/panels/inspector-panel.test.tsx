import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
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

vi.mock("@/lib/open-code-file", () => ({ openCodeFile: vi.fn() }))
vi.mock("@/ai/ask", () => ({ askAi: vi.fn(), showAgents: vi.fn() }))

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
    <button type="button" data-testid={`trigger-${value}`}>
      {children}
    </button>
  ),
  // Like Radix, only the active (default "inspect") tab's content is mounted.
  TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) =>
    value === "inspect" ? <div data-testid={`content-${value}`}>{children}</div> : null,
}))

import { askAi } from "@/ai/ask"
import { fetchWorkspaceSchemas } from "@/lib/api"
import { openCodeFile } from "@/lib/open-code-file"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { resetSchemasStore } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { useWorkflowDrafts } from "@/store/workflow-drafts"
import { InspectorPanel } from "./inspector-panel"

const sampleWorkflow: WorkflowFile = {
  lorien: 1,
  nodes: {
    save: {
      uses: "./nodes/save-user",
    },
    response: {
      uses: "@core/response",
      in: { body: "save.user" },
    },
  },
}

function resetStores() {
  resetSchemasStore()
  useSelectionStore.setState({ selectedNodeId: null, selectedNodeIds: [] })
  useLiveWorkflowStore.setState({ workflow: null, tabId: null })
  useWorkflowDrafts.setState({ drafts: {} })
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

  it("renders node id, uses, inputs, and outputs when a node is selected", async () => {
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
      expect(screen.getByLabelText("Node id")).toHaveValue("save")
    })

    // Node section
    expect(screen.getByText("./nodes/save-user")).toBeInTheDocument()

    // Inputs section — schema fields
    expect(screen.getByText("email")).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()

    // Outputs section — schema fields
    expect(screen.getByText("user")).toBeInTheDocument()

    // Config section must NOT be shown (config is no longer a separate panel)
    expect(screen.queryByText(/^config$/i)).not.toBeInTheDocument()
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
    const { container } = render(<InspectorPanel />)

    await waitFor(() => {
      // The color text label appears next to the swatch
      expect(screen.getByText("#3b82f6")).toBeInTheDocument()
    })

    // The swatch span has the background style set
    const swatch = container.querySelector<HTMLElement>('[style*="background"]')
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

  it("does not show a Config section (config is no longer surfaced in the inspector)", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "@core/response": {
        inputs: { type: "object", properties: {} },
        outputs: { type: "object", properties: {} },
      },
    })
    useSelectionStore.setState({ selectedNodeId: "response" })
    render(<InspectorPanel />)
    await waitFor(() => {
      expect(screen.getByLabelText("Node id")).toHaveValue("response")
    })
    // Config section should not appear at all
    expect(screen.queryByText(/^config$/i)).not.toBeInTheDocument()
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
          values: { path: "/api/data", method: "GET" },
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
      expect(screen.getByLabelText("Node id")).toHaveValue("http-request")
    })
    expect(screen.getByText("@core/http-request")).toBeInTheDocument()
    // "not found" error must NOT appear
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
  })
})

describe("InspectorPanel — several nodes selected", () => {
  it("lists the selected nodes, and a click inspects one on its own", () => {
    useSelectionStore.getState().setSelection(["save", "response"])
    render(<InspectorPanel />)
    expect(screen.getByText("2 nodes selected")).toBeDefined()
    fireEvent.click(screen.getByTitle("Inspect save on its own"))
    expect(useSelectionStore.getState().selectedNodeIds).toEqual(["save"])
    expect(screen.queryByText("2 nodes selected")).toBeNull()
  })
})

describe("InspectorPanel — Description section (A1)", () => {
  it("renders a Description section when schemas[uses].description is set", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": {
        inputs: { type: "object", properties: {} },
        outputs: { type: "object", properties: {} },
        description: "Creates a demo user record from the validated workflow inputs.",
      },
    })
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    await waitFor(() => {
      expect(screen.getByText("Description", { exact: false })).toBeInTheDocument()
    })
    expect(
      screen.getByText("Creates a demo user record from the validated workflow inputs."),
    ).toBeInTheDocument()
  })

  it("does NOT render a Description section when description is null", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": {
        inputs: { type: "object", properties: {} },
        outputs: { type: "object", properties: {} },
        description: null,
      },
    })
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    // Wait for async schemas to load
    await waitFor(() => {
      expect(screen.getByLabelText("Node id")).toHaveValue("save")
    })
    // "Description" section header should not appear when description is null
    // (it appears in uppercase so match case-insensitively)
    expect(screen.queryByText(/^description$/i)).not.toBeInTheDocument()
  })

  it("does NOT render a Description section when description is absent", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": {
        inputs: { type: "object", properties: {} },
        outputs: { type: "object", properties: {} },
      },
    })
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    await waitFor(() => {
      expect(screen.getByLabelText("Node id")).toHaveValue("save")
    })
    expect(screen.queryByText(/^description$/i)).not.toBeInTheDocument()
  })
})

describe("InspectorPanel — Recursive SchemaTree (A2)", () => {
  const nestedSchema = {
    "./nodes/save-user": {
      inputs: {
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
      outputs: { type: "object", properties: {} },
    },
  }

  it("top-level `user` row is expanded by default and shows nested children", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue(nestedSchema)
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    await waitFor(() => {
      expect(screen.getByText("user")).toBeInTheDocument()
    })

    // Nested children should be visible (depth=1 starts collapsed — depth=0 expands)
    // user is at depth 0, so its children (id, email) should be visible after expand
    // The top-level `user` button has ▾ chevron (expanded)
    expect(screen.getByText("▾")).toBeInTheDocument()
    expect(screen.getByText("id")).toBeInTheDocument()
    expect(screen.getByText("email")).toBeInTheDocument()
  })

  it("(object) type label does NOT appear as the only info for nested object properties", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue(nestedSchema)
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    await waitFor(() => {
      expect(screen.getByText("user")).toBeInTheDocument()
    })

    // The old flat renderer showed just "(object)" with no children visible.
    // Now children (id, email) must be visible.
    expect(screen.getByText("id")).toBeInTheDocument()
    expect(screen.getByText("email")).toBeInTheDocument()
  })

  it("clicking the chevron button collapses/hides the nested rows", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue(nestedSchema)
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)

    await waitFor(() => {
      expect(screen.getByText("user")).toBeInTheDocument()
    })

    // Children start visible (depth=0 → expanded by default)
    expect(screen.getByText("id")).toBeInTheDocument()

    // Click the expand button for "user" to collapse
    fireEvent.click(screen.getByRole("button", { name: /user/ }))

    // Children should be hidden after collapse
    expect(screen.queryByText("id")).not.toBeInTheDocument()
    expect(screen.queryByText("email")).not.toBeInTheDocument()

    // Chevron changes to ▸
    expect(screen.getByText("▸")).toBeInTheDocument()
  })
})

describe("InspectorPanel — rename node", () => {
  beforeEach(() => {
    useWorkflowDrafts.getState().load("tab-1", "workflows/x.workflow", sampleWorkflow)
    useSelectionStore.setState({ selectedNodeId: "save" })
  })

  it("renames the node, rewrites references and keeps it selected", () => {
    render(<InspectorPanel />)
    const input = screen.getByLabelText("Node id")
    fireEvent.change(input, { target: { value: "saveUser" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.blur(input)
    const wf = useWorkflowDrafts.getState().drafts["tab-1"]?.workflow
    expect(Object.keys(wf?.nodes ?? {})).toEqual(["saveUser", "response"])
    expect(wf?.nodes.response?.in).toEqual({ body: "saveUser.user" })
    expect(useSelectionStore.getState().selectedNodeId).toBe("saveUser")
  })

  it("rejects ids that cannot be referenced", () => {
    render(<InspectorPanel />)
    const input = screen.getByLabelText("Node id")
    fireEvent.change(input, { target: { value: "save-user" } })
    expect(screen.getByRole("alert").textContent).toMatch(/letters, digits/)
    fireEvent.blur(input)
    expect(input).toHaveValue("save")
    expect(
      Object.keys(useWorkflowDrafts.getState().drafts["tab-1"]?.workflow.nodes ?? {}),
    ).toContain("save")
  })

  it("rejects ids already in use", () => {
    render(<InspectorPanel />)
    fireEvent.change(screen.getByLabelText("Node id"), { target: { value: "response" } })
    expect(screen.getByRole("alert").textContent).toBe('"response" is already used')
  })

  it("Escape cancels the edit", () => {
    render(<InspectorPanel />)
    const input = screen.getByLabelText("Node id")
    fireEvent.change(input, { target: { value: "other" } })
    fireEvent.keyDown(input, { key: "Escape" })
    fireEvent.blur(input)
    expect(input).toHaveValue("save")
    expect(useWorkflowDrafts.getState().drafts["tab-1"]?.past).toHaveLength(0)
  })
})

describe("InspectorPanel — actions and input values", () => {
  it("View source opens the local node's .ts file", async () => {
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "View source" }))
    expect(openCodeFile).toHaveBeenCalledWith("nodes/save-user.ts")
  })

  it("hides View source for package nodes", async () => {
    useSelectionStore.setState({ selectedNodeId: "response" })
    render(<InspectorPanel />)
    await screen.findByRole("button", { name: "Explain" })
    expect(screen.queryByRole("button", { name: "View source" })).not.toBeInTheDocument()
  })

  it("Explain asks the AI about the selected node", async () => {
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)
    fireEvent.click(await screen.findByRole("button", { name: "Explain" }))
    expect(askAi).toHaveBeenCalledWith(expect.objectContaining({ title: "Explain save" }))
  })

  it("shows reference, literal and default input values with distinct styling", async () => {
    useLiveWorkflowStore.setState({
      workflow: {
        lorien: 1,
        nodes: {
          save: {
            uses: "./nodes/save-user",
            in: { email: "req.body.email" },
            values: { role: "admin" },
          },
        },
      },
      tabId: "tab-1",
    })
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": {
        inputs: {
          type: "object",
          properties: {
            email: { type: "string" },
            role: { type: "string" },
            active: { type: "boolean", default: true },
          },
        },
        outputs: { type: "object", properties: {} },
      },
    })
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)
    expect(await screen.findByText("req.body.email")).toHaveClass("text-primary")
    expect(screen.getByText('"admin"')).toHaveClass("text-foreground")
    expect(screen.getByText("true")).toHaveClass("italic", "text-muted-foreground")
  })
})

describe("InspectorPanel — condition", () => {
  const branching: WorkflowFile = {
    lorien: 1,
    nodes: {
      save: { uses: "./nodes/save-user" },
      response: { uses: "@core/response", when: "save.ok", in: { body: "save.user" } },
    },
  }
  beforeEach(() => {
    useWorkflowDrafts.getState().load("tab-1", "workflows/x.workflow", branching)
    useLiveWorkflowStore.setState({ workflow: branching, tabId: "tab-1" })
    useSelectionStore.setState({ selectedNodeId: "response" })
  })

  it("shows the condition and flips which branch the node runs on", () => {
    render(<InspectorPanel />)
    expect(screen.getByLabelText("Condition")).toHaveTextContent("save.ok")
    expect(screen.getByRole("button", { name: "when true" })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    fireEvent.click(screen.getByRole("button", { name: "when false" }))
    expect(useWorkflowDrafts.getState().drafts["tab-1"]?.workflow.nodes.response?.when).toBe(
      "!save.ok",
    )
  })

  it("says Always for a node without one", () => {
    useSelectionStore.setState({ selectedNodeId: "save" })
    render(<InspectorPanel />)
    expect(screen.getByLabelText("Condition")).toHaveTextContent("Always")
    expect(screen.queryByRole("button", { name: "when false" })).not.toBeInTheDocument()
  })
})
