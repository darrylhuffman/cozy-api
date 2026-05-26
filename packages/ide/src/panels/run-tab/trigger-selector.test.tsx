import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { TriggerSelector } from "./trigger-selector"
import { fetchWorkspaceSchemas, type NodeSchemas, type WorkflowFile } from "@/lib/api"

// Mock fetchWorkspaceSchemas BEFORE any tests render TriggerSelector.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    fetchWorkspaceSchemas: vi.fn(),
  }
})

const baseStoreReset = () => {
  useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
}

function setWorkflow(wf: WorkflowFile | null) {
  useLiveWorkflowStore.setState({ workflow: wf } as never)
}

async function waitFor(
  fn: () => void,
  { timeout = 1000 }: { timeout?: number } = {},
): Promise<void> {
  const start = Date.now()
  while (true) {
    try {
      fn()
      return
    } catch (e) {
      if (Date.now() - start > timeout) throw e
      await new Promise((r) => setTimeout(r, 20))
    }
  }
}

describe("TriggerSelector default bodyKind", () => {
  beforeEach(() => {
    baseStoreReset()
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({})
  })
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

const saveUserSchema: NodeSchemas = {
  inputs: {
    type: "object",
    properties: {
      email: { type: "string" },
      password: { type: "string" },
    },
  },
  outputs: { type: "object" },
}

describe("TriggerSelector — trigger-aware pre-fill", () => {
  beforeEach(() => {
    baseStoreReset()
    vi.mocked(fetchWorkspaceSchemas).mockReset()
  })
  afterEach(() => {
    cleanup()
    baseStoreReset()
    setWorkflow(null)
  })

  it("pre-fills body from connected consumer input schema", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": saveUserSchema,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
        SaveUser: {
          uses: "./nodes/save-user",
          in: {
            email: "Request.body.email",
            password: "Request.body.password",
          },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    await waitFor(() => {
      const body = useDebugSessionStore.getState().requestForm.body
      expect(body.trim().length).toBeGreaterThan(0)
    })
    const form = useDebugSessionStore.getState().requestForm
    expect(form.bodyKind).toBe("json")
    const parsed = JSON.parse(form.body) as Record<string, unknown>
    expect(parsed).toEqual({ email: "", password: "" })
  })

  it("pre-fill is skipped when body is already typed", async () => {
    useDebugSessionStore.getState().setRequestForm((cur) => ({
      ...cur,
      body: '{ "manual": "edit" }',
    }))
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": saveUserSchema,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
        SaveUser: {
          uses: "./nodes/save-user",
          in: { email: "Request.body.email" },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    await new Promise((r) => setTimeout(r, 30))
    const body = useDebugSessionStore.getState().requestForm.body
    expect(body).toBe('{ "manual": "edit" }')
  })

  it("auto-adds Content-Type when body has shape", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/save-user": saveUserSchema,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "POST", path: "/users" },
        },
        SaveUser: {
          uses: "./nodes/save-user",
          in: { email: "Request.body.email" },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    await waitFor(() => {
      const headers = useDebugSessionStore.getState().requestForm.headers
      expect(headers).toContainEqual(["Content-Type", "application/json"])
    })
  })

  it("pre-fills query rows from query references", async () => {
    vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
      "./nodes/search": {
        inputs: {
          type: "object",
          properties: {
            q: { type: "string" },
            limit: { type: "integer" },
          },
        },
        outputs: { type: "object" },
      } as NodeSchemas,
    })
    setWorkflow({
      lorien: 1,
      nodes: {
        Request: {
          uses: "@core/http-request",
          values: { method: "GET", path: "/search" },
        },
        Search: {
          uses: "./nodes/search",
          in: {
            q: "Request.query.q",
            limit: "Request.query.limit",
          },
        },
      },
    } as unknown as WorkflowFile)
    render(<TriggerSelector />)
    await waitFor(() => {
      const query = useDebugSessionStore.getState().requestForm.query
      expect(query.length).toBe(2)
    })
    const query = useDebugSessionStore.getState().requestForm.query
    expect(query.map(([k]) => k).sort()).toEqual(["limit", "q"])
  })
})
