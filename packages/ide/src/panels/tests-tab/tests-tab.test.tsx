import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    fetchFile: vi.fn(),
    saveFile: vi.fn(),
    runNodeTests: vi.fn(),
    fetchWorkspaceSchemas: vi.fn(),
  }
})
vi.mock("@/lib/events", () => ({ subscribeToFileEvents: vi.fn(() => () => {}) }))

import { ApiError, fetchFile, fetchWorkspaceSchemas, runNodeTests, saveFile } from "@/lib/api"
import { useConfirmStore } from "@/store/confirm"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useNodeCases } from "@/store/node-cases"
import { resetSchemasStore } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import { TestsTab } from "./index"

const CASES = "nodes/user/save-user.cases.json"
const caseFile = {
  lorien: 1,
  cases: [
    {
      id: "saves",
      name: "Saves a user",
      input: { email: "a@b.co" },
      expect: { output: { user: {} } },
    },
    {
      id: "rejects",
      name: "Rejects short passwords",
      input: { email: "a@b.co" },
      expect: { error: "password" },
    },
  ],
}

function files(map: Record<string, unknown>) {
  vi.mocked(fetchFile).mockImplementation(async (path: string) => {
    if (path in map) return { path, content: JSON.stringify(map[path]) }
    throw new ApiError("File not found", 404)
  })
}

beforeEach(() => {
  files({ [CASES]: caseFile })
  vi.mocked(saveFile).mockResolvedValue({ path: CASES, bytes: 1 })
  vi.mocked(fetchWorkspaceSchemas).mockResolvedValue({
    "./nodes/user/save-user": {
      name: "Save User",
      inputs: { type: "object", properties: { email: { type: "string" } } },
      outputs: { type: "object" },
    },
  })
  vi.mocked(runNodeTests).mockResolvedValue({
    logs: "[info] saved",
    files: [
      {
        path: CASES,
        uses: "./nodes/user/save-user",
        results: [
          { caseId: "saves", name: "Saves a user", passed: true, failures: [], durationMs: 3 },
          {
            caseId: "rejects",
            name: "Rejects short passwords",
            passed: false,
            failures: ['expected an error containing "password", but it returned {}'],
            durationMs: 1,
          },
        ],
      },
    ],
  })
  resetSchemasStore()
  useNodeCases.setState({ byNode: {}, results: {}, running: {}, lastLogs: "", runError: null })
  useTabsStore.setState({
    tabs: [
      {
        id: "t",
        title: "create.workflow",
        kind: "workflow",
        path: "workflows/user/create.workflow",
      },
    ],
    activeWorkflowId: "t",
    activeCodeId: null,
  })
  useLiveWorkflowStore.setState({
    tabId: "t",
    workflow: {
      lorien: 1,
      nodes: {
        Request: { uses: "@core/http-request" },
        SaveUser: { uses: "./nodes/user/save-user" },
        Response: { uses: "@core/response" },
      },
    },
  })
  useSelectionStore.setState({ selectedNodeId: "SaveUser" })
  useDebugSessionStore.setState({ runs: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Tests tab", () => {
  it("lists a group per local node, not built-ins, and opens the selected one", async () => {
    render(<TestsTab />)
    expect(await screen.findByText("Saves a user")).toBeInTheDocument()
    expect(screen.getAllByTestId("node-cases-group")).toHaveLength(1)
    expect(screen.getByText("Save User")).toBeInTheDocument()
    expect(fetchFile).toHaveBeenCalledWith(CASES)
  })

  it("explains when a workflow only uses built-in nodes", () => {
    useLiveWorkflowStore.setState({
      workflow: { lorien: 1, nodes: { R: { uses: "@core/response" } } },
    })
    render(<TestsTab />)
    expect(screen.getByText(/only uses built-in nodes/)).toBeInTheDocument()
  })

  it("runs a node's cases and shows pass counts, failures and node output", async () => {
    render(<TestsTab />)
    await screen.findByText("Saves a user")
    fireEvent.click(screen.getByRole("button", { name: "Run Save User cases" }))
    expect(await screen.findByText("1/2 passed")).toBeInTheDocument()
    expect(runNodeTests).toHaveBeenCalledWith({ only: { [CASES]: ["saves", "rejects"] } })
    expect(
      screen.getByText('expected an error containing "password", but it returned {}'),
    ).toBeInTheDocument()
    expect(screen.getByText("[info] saved")).toBeInTheDocument()
  })

  it("shows why the runner failed", async () => {
    vi.mocked(runNodeTests).mockRejectedValue(
      new ApiError("tsx is not installed in this workspace", 500),
    )
    render(<TestsTab />)
    await screen.findByText("Saves a user")
    fireEvent.click(screen.getByRole("button", { name: "Run all" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/tsx is not installed/)
  })

  it("creates a case from the schema sample, saves it and runs just that case", async () => {
    files({})
    render(<TestsTab />)
    fireEvent.click(await screen.findByRole("button", { name: /New case/ }))
    expect(
      JSON.parse((screen.getByLabelText("Case input") as HTMLTextAreaElement).value),
    ).toHaveProperty("email")
    fireEvent.change(screen.getByLabelText("Case name"), { target: { value: "Rejects bad email" } })
    fireEvent.click(screen.getByLabelText("It throws"))
    fireEvent.change(screen.getByLabelText("Expected error"), { target: { value: "email" } })
    fireEvent.click(screen.getByRole("button", { name: "Save case" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    const [path, content] = vi.mocked(saveFile).mock.calls[0]!
    expect(path).toBe(CASES)
    expect(JSON.parse(content).cases).toEqual([
      {
        id: "rejectsBadEmail",
        name: "Rejects bad email",
        input: { email: expect.any(String) },
        expect: { error: "email" },
      },
    ])
    await waitFor(() =>
      expect(runNodeTests).toHaveBeenCalledWith({ only: { [CASES]: ["rejectsBadEmail"] } }),
    )
  })

  it("edits an existing case in place", async () => {
    render(<TestsTab />)
    fireEvent.click(await screen.findByText("Saves a user"))
    fireEvent.change(screen.getByLabelText("Case name"), {
      target: { value: "Saves a user record" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save case" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    const saved = JSON.parse(vi.mocked(saveFile).mock.calls[0]![1]).cases
    expect(saved.map((c: { id: string; name: string }) => [c.id, c.name])).toEqual([
      ["saves", "Saves a user record"],
      ["rejects", "Rejects short passwords"],
    ])
  })

  it("builds a case from the last debug run of this node", async () => {
    useDebugSessionStore.setState({
      runs: [
        {
          runId: "r",
          workflowPath: "workflows/user/create.workflow",
          triggerNodeId: "Request",
          request: { method: "POST", path: "/users" },
          startedAt: 0,
          events: [
            {
              offsetMs: 0,
              event: { type: "before-node", nodeId: "SaveUser", input: { email: "z@z.io" } },
            },
            {
              offsetMs: 1,
              event: {
                type: "after-node",
                nodeId: "SaveUser",
                output: { user: { id: "9" } },
                durationMs: 1,
              },
            },
          ],
          logs: [],
          pausedFrame: null,
          outcome: { kind: "running" },
        },
      ],
    })
    render(<TestsTab />)
    fireEvent.click(await screen.findByRole("button", { name: /From last run/ }))
    expect(JSON.parse((screen.getByLabelText("Case input") as HTMLTextAreaElement).value)).toEqual({
      email: "z@z.io",
    })
    expect(
      JSON.parse((screen.getByLabelText("Expected output") as HTMLTextAreaElement).value),
    ).toEqual({
      user: { id: "9" },
    })
    expect(screen.getByLabelText("Output equals")).toBeChecked()
  })

  it("deletes a case after confirming", async () => {
    render(<TestsTab />)
    await screen.findByText("Rejects short passwords")
    fireEvent.click(screen.getByRole("button", { name: "Delete Rejects short passwords" }))
    await act(async () => useConfirmStore.getState().answer(true))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    expect(JSON.parse(vi.mocked(saveFile).mock.calls[0]![1]).cases).toHaveLength(1)
  })
})
