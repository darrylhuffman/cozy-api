import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTabsStore } from "@/store/tabs"
import { CodeEditor } from "./code-editor"

// Mock @monaco-editor/react — jsdom can't instantiate Monaco's full editor.
// We capture the onMount callback so tests can simulate Ctrl-S.
let capturedOnMount: ((editor: unknown, monaco: unknown) => void) | null = null

vi.mock("@monaco-editor/react", () => ({
  default: ({
    value,
    path,
    onMount,
    onChange,
  }: {
    value: string
    path: string
    onMount?: (editor: unknown, monaco: unknown) => void
    onChange?: (v: string) => void
  }) => {
    capturedOnMount = onMount ?? null
    // Expose onChange for tests that need to simulate editing
    if (onChange) onChange(value)
    return (
      <div data-testid="monaco-stub" data-path={path}>
        {value}
      </div>
    )
  },
}))

// Mock events module — SSE isn't available in jsdom
vi.mock("@/lib/events", () => ({
  subscribeToFileEvents: vi.fn(() => () => {}),
}))

function resetStore() {
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
}

beforeEach(() => {
  capturedOnMount = null
  resetStore()
  useTabsStore.getState().openTab({ id: "test-tab", title: "foo.ts", kind: "node" })
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    if (method === "PUT") {
      return Promise.resolve(
        new Response(JSON.stringify({ path: "nodes/foo.ts", bytes: 18 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    }
    return Promise.resolve(
      new Response(JSON.stringify({ path: "nodes/foo.ts", content: "export const x = 1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetStore()
})

describe("CodeEditor", () => {
  it("shows loading state then renders Monaco with the file's content", async () => {
    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
    expect(screen.getByTestId("monaco-stub")).toHaveTextContent("export const x = 1")
    expect(screen.getByTestId("monaco-stub").getAttribute("data-path")).toBe("nodes/foo.ts")
  })

  it("shows an error if the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"))
    render(<CodeEditor path="nodes/bad.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByText(/Error loading file/)).toBeInTheDocument())
  })

  it("shows 'Saved' status pill after a successful Ctrl-S save", async () => {
    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())

    // Simulate Monaco calling onMount with a fake editor + monaco
    const fakeMonaco = {
      KeyMod: { CtrlCmd: 1 },
      KeyCode: { KeyS: 83 },
    }
    const fakeEditor = {
      addCommand: (_key: number, handler: () => void) => {
        // Call handler immediately to simulate Ctrl-S
        handler()
      },
    }
    capturedOnMount?.(fakeEditor, fakeMonaco)

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
  })

  it("calls setDirty(false) in the store after a successful save", async () => {
    // Spy on the store action to observe the false call, independent of any re-render
    // that may re-mark dirty via the mock's onChange.
    const setDirtySpy = vi.spyOn(useTabsStore.getState(), "setDirty")

    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())

    const fakeMonaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 83 } }
    const fakeEditor = {
      addCommand: (_key: number, handler: () => void) => {
        handler()
      },
    }
    capturedOnMount?.(fakeEditor, fakeMonaco)

    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())

    // setDirty must have been called with false at some point during save
    expect(setDirtySpy).toHaveBeenCalledWith("test-tab", false)
  })

  it("shows error pill if save fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "PUT") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "disk full" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ path: "nodes/foo.ts", content: "export const x = 1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    })

    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())

    const fakeMonaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 83 } }
    const fakeEditor = {
      addCommand: (_key: number, handler: () => void) => {
        handler()
      },
    }
    capturedOnMount?.(fakeEditor, fakeMonaco)

    await waitFor(() => expect(screen.getByText("disk full")).toBeInTheDocument())
  })
})
