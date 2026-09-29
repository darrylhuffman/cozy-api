import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { subscribeToFileEvents } from "@/lib/events"
import { useCodeDrafts } from "@/store/code-drafts"
import { useTabsStore } from "@/store/tabs"
import { CodeEditor } from "./code-editor"

// Mock @monaco-editor/react — jsdom can't instantiate Monaco's full editor.
// We capture the onMount callback so tests can simulate Ctrl-S.
let capturedOnMount: ((editor: unknown, monaco: unknown) => void) | null = null
let capturedOnChange: ((v: string) => void) | null = null

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
    capturedOnChange = onChange ?? null
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
  useCodeDrafts.setState({ drafts: {} })
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

  const pressCtrlS = () => {
    const fakeMonaco = { KeyMod: { CtrlCmd: 1 }, KeyCode: { KeyS: 83 } }
    capturedOnMount?.({ addCommand: (_k: number, handler: () => void) => handler() }, fakeMonaco)
  }

  it("keeps unsaved edits across an unmount/remount (tab switch)", async () => {
    const first = render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
    act(() => capturedOnChange?.("export const x = 2"))
    await waitFor(() => {
      expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(true)
    })
    first.unmount()

    const fetchSpy = vi.mocked(globalThis.fetch)
    fetchSpy.mockClear()
    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    expect(screen.getByTestId("monaco-stub")).toHaveTextContent("export const x = 2")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(true)
  })

  it("saves the latest text of this tab", async () => {
    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
    act(() => capturedOnChange?.("export const x = 42"))
    pressCtrlS()
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument())
    const put = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([, init]) => (init?.method ?? "GET").toUpperCase() === "PUT")
    expect(JSON.parse(put![1]!.body as string)).toEqual({
      path: "nodes/foo.ts",
      content: "export const x = 42",
    })
    expect(useTabsStore.getState().tabs.find((t) => t.id === "test-tab")?.dirty).toBe(false)
  })

  it("shows a conflict notice when the file changes on disk under unsaved edits", async () => {
    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
    act(() => capturedOnChange?.("mine"))
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ path: "nodes/foo.ts", content: "theirs" }), { status: 200 }),
    )
    const listener = vi.mocked(subscribeToFileEvents).mock.calls.at(-1)![0]
    act(() => listener({ type: "change", path: "nodes/foo.ts" }))
    await waitFor(() => expect(screen.getByText(/changed on disk/i)).toBeInTheDocument())
    expect(screen.getByTestId("monaco-stub")).toHaveTextContent("mine")
    fireEvent.click(screen.getByRole("button", { name: "Reload from disk" }))
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toHaveTextContent("theirs"))
  })

  it("reloads a clean file when it changes on disk", async () => {
    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ path: "nodes/foo.ts", content: "updated by agent" }), {
        status: 200,
      }),
    )
    const listener = vi.mocked(subscribeToFileEvents).mock.calls.at(-1)![0]
    act(() => listener({ type: "change", path: "nodes/foo.ts" }))
    await waitFor(() =>
      expect(screen.getByTestId("monaco-stub")).toHaveTextContent("updated by agent"),
    )
    expect(screen.queryByText(/changed on disk/i)).not.toBeInTheDocument()
  })

  it("offers Retry after a load failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"))
    render(<CodeEditor path="nodes/foo.ts" tabId="test-tab" />)
    await waitFor(() => expect(screen.getByText(/Error loading file/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
  })
})
