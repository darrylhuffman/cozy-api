import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkflowFile } from "@/lib/api"

// Mock @xyflow/react — the actual library uses ResizeObserver + canvas APIs
// that aren't available in jsdom. We replace with minimal stubs.
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ nodes }: { nodes: { id: string }[] }) => (
    <div data-testid="react-flow" data-nodecount={nodes.length}>
      {nodes.map((n) => (
        <div key={n.id} data-testid={`rf-node-${n.id}`} />
      ))}
    </div>
  ),
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
}))

// Mock the CSS import from @xyflow/react
vi.mock("@xyflow/react/dist/style.css", () => ({}))

// Mock fetchWorkflowFile
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>()
  return {
    ...actual,
    fetchWorkflowFile: vi.fn(),
  }
})

import { fetchWorkflowFile } from "@/lib/api"
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

beforeEach(() => {
  useThemeStore.setState({ theme: "light" })
  vi.mocked(fetchWorkflowFile).mockResolvedValue(sampleWorkflow)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("WorkflowEditor", () => {
  it("shows a loading state while fetching", () => {
    // Don't resolve yet
    vi.mocked(fetchWorkflowFile).mockReturnValue(new Promise(() => {}))
    render(<WorkflowEditor path="workflows/users/create.workflow" />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it("renders React Flow with one node per workflow node after fetch", async () => {
    render(<WorkflowEditor path="workflows/users/create.workflow" />)
    await waitFor(() => {
      expect(screen.getByTestId("react-flow")).toBeInTheDocument()
    })
    // 3 nodes in sampleWorkflow
    expect(screen.getByTestId("react-flow").dataset.nodecount).toBe("3")
    expect(screen.getByTestId("rf-node-parseBody")).toBeInTheDocument()
    expect(screen.getByTestId("rf-node-validate")).toBeInTheDocument()
    expect(screen.getByTestId("rf-node-save")).toBeInTheDocument()
  })

  it("shows an error state when fetch fails", async () => {
    vi.mocked(fetchWorkflowFile).mockRejectedValue(new Error("Network error"))
    render(<WorkflowEditor path="workflows/users/create.workflow" />)
    await waitFor(() => {
      expect(screen.getByText(/error loading workflow/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Network error/)).toBeInTheDocument()
  })

  it("re-fetches when path changes", async () => {
    const { rerender } = render(<WorkflowEditor path="workflows/users/create.workflow" />)
    await waitFor(() => screen.getByTestId("react-flow"))
    expect(vi.mocked(fetchWorkflowFile)).toHaveBeenCalledWith("workflows/users/create.workflow")

    rerender(<WorkflowEditor path="workflows/auth/login.workflow" />)
    await waitFor(() => {
      expect(vi.mocked(fetchWorkflowFile)).toHaveBeenCalledWith("workflows/auth/login.workflow")
    })
  })
})
