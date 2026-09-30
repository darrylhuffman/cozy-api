import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, fetchFile: vi.fn(), saveFile: vi.fn() }
})
vi.mock("@/lib/events", () => ({ subscribeToFileEvents: vi.fn(() => () => {}) }))
vi.mock("@/panels/run-tab/send-request", () => ({ sendRequest: vi.fn(), sendAll: vi.fn() }))

import type { RequestRunResult } from "@darrylondil/lorien-runtime/requests"
import { fetchFile } from "@/lib/api"
import { sendRequest } from "@/panels/run-tab/send-request"
import { useInspectorTab } from "@/store/inspector-tab"
import { useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"
import { testTags, WorkflowTests } from "./workflow-tests"

const WF = "workflows/pets/add.workflow"
const collection = {
  lorien: 1,
  requests: [
    { id: "adds", name: "Adds a pet", method: "POST", path: "/pets" },
    {
      id: "dbDown",
      name: "Reports a database failure",
      method: "POST",
      path: "/pets",
      mocks: { AddPet: { error: "database is locked" } },
      expect: [
        { target: "status", op: "equals", value: 500 },
        { target: "node", node: "Response", op: "notExists" },
      ],
    },
  ],
}

const failed: RequestRunResult = {
  requestId: "dbDown",
  name: "Reports a database failure",
  request: { method: "POST", url: "http://x/pets", headers: {} },
  response: { status: 201, headers: {}, body: {}, durationMs: 4 },
  assertions: [
    {
      assertion: { target: "status", op: "equals", value: 500 },
      pass: false,
      actual: 201,
      message: "expected status equals 500, got 201",
    },
  ],
  captured: {},
  missingVariables: [],
  passed: false,
}

beforeEach(() => {
  vi.mocked(fetchFile).mockResolvedValue({
    path: "workflows/pets/add.requests.json",
    content: JSON.stringify(collection),
  })
  useRequestCollections.setState({ byWorkflow: {}, results: {} })
  useRequestEditor.getState().reset()
  useInspectorTab.getState().setTab("tests")
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Workflow tests", () => {
  it("lists the workflow's saved requests with their mocks and step checks", async () => {
    render(<WorkflowTests workflowPath={WF} />)
    expect(await screen.findByText("Adds a pet")).toBeInTheDocument()
    expect(screen.getByText("1 mocked · 1 step check")).toBeInTheDocument()
    expect(screen.getAllByRole("img", { name: "not run" })).toHaveLength(2)
  })

  it("runs a test and shows why it failed", async () => {
    vi.mocked(sendRequest).mockResolvedValue(failed)
    render(<WorkflowTests workflowPath={WF} />)
    fireEvent.click(await screen.findByRole("button", { name: "Run Reports a database failure" }))
    expect(await screen.findByText("expected status equals 500, got 201")).toBeInTheDocument()
    expect(screen.getByText("0/1 passed")).toBeInTheDocument()
    expect(sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dbDown" }),
      expect.objectContaining({ workflowPath: WF }),
    )
  })

  it("opens a test in the Run tab, mocks included", async () => {
    render(<WorkflowTests workflowPath={WF} />)
    fireEvent.click(await screen.findByText("Reports a database failure"))
    expect(useInspectorTab.getState().tab).toBe("run")
    expect(useRequestEditor.getState().editingId).toBe("dbDown")
    expect(useRequestEditor.getState().mocks).toEqual([
      { node: "AddPet", kind: "error", text: "database is locked" },
    ])
  })

  it("tags only what a test adds", () => {
    expect(testTags({ id: "a", name: "A", method: "GET", path: "/" })).toBe("")
  })
})
