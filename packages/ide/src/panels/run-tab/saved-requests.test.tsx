import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return {
    ...actual,
    fetchFile: vi.fn(),
    saveFile: vi.fn(),
    createWorkspaceFile: vi.fn(),
    fetchWorkspaceSchemas: vi.fn().mockResolvedValue({}),
  }
})
vi.mock("@/lib/events", () => ({ subscribeToFileEvents: vi.fn(() => () => {}) }))
vi.mock("@/lib/open-code-file", () => ({ openCodeFile: vi.fn() }))
vi.mock("@/ai/ask", () => ({ askAi: vi.fn() }))

import { askAi } from "@/ai/ask"
import { ApiError, createWorkspaceFile, fetchFile, saveFile } from "@/lib/api"
import { openCodeFile } from "@/lib/open-code-file"
import { useConfirmStore } from "@/store/confirm"
import { useDebugSessionStore } from "@/store/debug-session"
import { useEnvironments } from "@/store/environments"
import { useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"
import { useRequestHistoryStore } from "@/store/request-history"
import { EnvironmentPicker } from "./environment-picker"
import { RequestBuilder } from "./request-builder"
import { SavedRequests } from "./saved-requests"

const WF = "workflows/users/create.workflow"
const COLLECTION = "workflows/users/create.requests.json"

const collection = {
  lorien: 1,
  requests: [
    {
      id: "createsAUser",
      name: "Creates a user",
      trigger: "request",
      method: "POST",
      path: "/users",
      headers: { Authorization: "Bearer {{token}}" },
      body: { kind: "json", json: { email: "a@b.co" } },
      expect: [{ target: "status", op: "equals", value: 201 }],
    },
    { id: "listsUsers", name: "Lists users", method: "GET", path: "/users" },
  ],
}

const envFile = { lorien: 1, default: "local", environments: { local: { token: "t0k" } } }

let fetchMock: ReturnType<typeof vi.fn>

function files(map: Record<string, unknown>) {
  vi.mocked(fetchFile).mockImplementation(async (path: string) => {
    if (path in map) return { path, content: JSON.stringify(map[path]) }
    throw new ApiError("File not found", 404)
  })
}

function Harness() {
  return (
    <>
      <EnvironmentPicker />
      <SavedRequests workflowPath={WF} />
      <RequestBuilder workflowPath={WF} />
    </>
  )
}

beforeEach(() => {
  localStorage.clear()
  files({ [COLLECTION]: collection, "lorien.environments.json": envFile })
  vi.mocked(saveFile).mockResolvedValue({ path: COLLECTION, bytes: 1 })
  fetchMock = vi.fn(async () => Response.json({ id: "u1" }, { status: 201 }))
  vi.stubGlobal("fetch", fetchMock)
  useRequestCollections.setState({ byWorkflow: {}, results: {} })
  useRequestEditor.getState().reset()
  useEnvironments.setState({
    envs: { lorien: 1, environments: {} },
    loaded: false,
    error: null,
    selected: null,
  })
  useRequestHistoryStore.setState({ entries: [] })
  useDebugSessionStore.getState().setRequestForm(() => ({
    triggerNodeId: "request",
    method: "POST",
    path: "/users",
    bodyKind: "json",
    body: '{"email": "{{email}}"}',
    formBody: [],
    query: [],
    headers: [],
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("saved requests", () => {
  it("lists the workflow's saved requests", async () => {
    render(<Harness />)
    expect(await screen.findByText("Creates a user")).toBeInTheDocument()
    expect(screen.getByText("Lists users")).toBeInTheDocument()
    expect(fetchFile).toHaveBeenCalledWith(COLLECTION)
  })

  it("explains where requests are saved when there are none", async () => {
    files({})
    render(<Harness />)
    expect(await screen.findByText(/Nothing saved for this workflow yet/)).toBeInTheDocument()
    expect(screen.getByText(COLLECTION)).toBeInTheDocument()
  })

  it("shows a readable error for a broken collection file", async () => {
    vi.mocked(fetchFile).mockImplementation(async (path: string) => {
      if (path === COLLECTION) return { path, content: "{" }
      throw new ApiError("File not found", 404)
    })
    render(<Harness />)
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /create.requests.json is not valid JSON/,
    )
  })

  it("opening a request loads it into the builder", async () => {
    render(<Harness />)
    fireEvent.click(await screen.findByText("Creates a user"))
    expect(screen.getByLabelText("Request name")).toHaveValue("Creates a user")
    expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
      ["Authorization", "Bearer {{token}}"],
    ])
    expect(screen.getAllByTestId("assertion-row")).toHaveLength(1)
  })

  it("runs one request with environment variables and records the result", async () => {
    render(<Harness />)
    await screen.findByText("Creates a user")
    await waitFor(() => expect(screen.getByLabelText("Environment")).toHaveValue("local"))
    fireEvent.click(screen.getByRole("button", { name: "Run Creates a user" }))
    await waitFor(() => expect(screen.getByText("1/1 passed")).toBeInTheDocument())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe("http://localhost:3000/users")
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer t0k" })
    expect(useRequestHistoryStore.getState().entries).toHaveLength(1)
    // The run request becomes the open one, with its result under the builder.
    expect(useRequestEditor.getState().editingId).toBe("createsAUser")
    await waitFor(() => expect(useRequestEditor.getState().lastResult?.passed).toBe(true))
  })

  it("Run all runs every request in order and counts failures", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) =>
      init.method === "POST" ? Response.json({}, { status: 500 }) : Response.json([]),
    )
    render(<Harness />)
    await screen.findByText("Creates a user")
    fireEvent.click(screen.getByRole("button", { name: "Run all" }))
    await waitFor(() => expect(screen.getByText("1/2 passed")).toBeInTheDocument())
    expect(fetchMock.mock.calls.map((c) => (c[1] as RequestInit).method)).toEqual(["POST", "GET"])
    expect(screen.getAllByLabelText("failed")).toHaveLength(1)
  })

  it("deleting asks first and rewrites the file", async () => {
    render(<Harness />)
    await screen.findByText("Lists users")
    fireEvent.click(screen.getByRole("button", { name: "Delete Lists users" }))
    await act(async () => useConfirmStore.getState().answer(true))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    const [path, content] = vi.mocked(saveFile).mock.calls[0]!
    expect(path).toBe(COLLECTION)
    expect(JSON.parse(content).requests.map((r: { id: string }) => r.id)).toEqual(["createsAUser"])
  })
})

describe("request builder", () => {
  it("saves a new request with its checks to the collection file", async () => {
    files({})
    render(<Harness />)
    await screen.findByText(/Nothing saved/)
    fireEvent.change(screen.getByLabelText("Request name"), {
      target: { value: "Rejects bad email" },
    })
    fireEvent.click(screen.getByText("+ Add check"))
    fireEvent.change(screen.getByLabelText("Expected value"), { target: { value: "422" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(saveFile).toHaveBeenCalled())
    const saved = JSON.parse(vi.mocked(saveFile).mock.calls[0]![1])
    expect(saved.requests).toEqual([
      {
        id: "rejectsBadEmail",
        name: "Rejects bad email",
        method: "POST",
        path: "/users",
        trigger: "request",
        body: { kind: "json", json: { email: "{{email}}" } },
        expect: [{ target: "status", op: "equals", value: 422 }],
      },
    ])
    expect(await screen.findByText("Rejects bad email")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save as new" })).toBeInTheDocument()
  })

  it("refuses to save a body that is not valid JSON and says how to use variables", async () => {
    render(<Harness />)
    await screen.findByText("Creates a user")
    useDebugSessionStore.getState().setRequestForm((c) => ({ ...c, body: "{ email: {{email}} }" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect((await screen.findByRole("alert")).textContent).toMatch(/Put variables inside strings/)
    expect(saveFile).not.toHaveBeenCalled()
  })

  it("Send shows the response, check results and undefined variables", async () => {
    render(<Harness />)
    await screen.findByText("Creates a user")
    fireEvent.click(screen.getByText("+ Add check"))
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    const result = await screen.findByTestId("request-result")
    expect(within(result).getByText("Failed")).toBeInTheDocument()
    expect(within(result).getByText("expected status equals 200, got 201")).toBeInTheDocument()
    expect(within(result).getByText(/Undefined variables: \{\{email\}\}/)).toBeInTheDocument()
  })

  it("asks the AI why a failed request failed", async () => {
    render(<Harness />)
    await screen.findByText("Creates a user")
    fireEvent.click(screen.getByText("+ Add check"))
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    fireEvent.click(await screen.findByRole("button", { name: /Ask AI why it failed/ }))
    const req = vi.mocked(askAi).mock.calls[0]![0]
    expect(req.headline).toContain(WF)
    expect(req.context.join("\n")).toContain("expected status equals 200, got 201")
  })

  it("asks the AI to write requests for the workflow, with the existing ones", async () => {
    render(<Harness />)
    await screen.findByText("Creates a user")
    fireEvent.click(screen.getByRole("button", { name: /Write with AI/ }))
    const req = vi.mocked(askAi).mock.calls[0]![0]
    expect(req.headline).toContain(COLLECTION)
    expect(req.context.join("\n")).toContain("createsAUser")
  })

  it("adds checks from the last response", async () => {
    render(<Harness />)
    await screen.findByText("Creates a user")
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    fireEvent.click(await screen.findByText("Add checks from this response"))
    expect(useRequestEditor.getState().expect).toEqual([
      { target: "status", op: "equals", value: 201 },
      { target: "header", path: "content-type", op: "contains", value: "application/json" },
      { target: "body", path: "id", op: "exists" },
    ])
  })
})

describe("environment picker", () => {
  it("creates the environments file from a template when missing, then opens it", async () => {
    files({})
    vi.mocked(createWorkspaceFile).mockResolvedValue()
    render(<EnvironmentPicker />)
    fireEvent.click(await screen.findByRole("button", { name: "Add" }))
    await waitFor(() => expect(openCodeFile).toHaveBeenCalledWith("lorien.environments.json"))
    expect(vi.mocked(createWorkspaceFile).mock.calls[0]![0]).toBe("lorien.environments.json")
  })

  it("remembers the chosen environment", async () => {
    files({ "lorien.environments.json": { ...envFile, environments: { local: {}, staging: {} } } })
    render(<EnvironmentPicker />)
    await waitFor(() => expect(screen.getByLabelText("Environment")).toHaveValue("local"))
    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "staging" } })
    expect(localStorage.getItem("lorien-ide-environment")).toBe("staging")
  })
})
