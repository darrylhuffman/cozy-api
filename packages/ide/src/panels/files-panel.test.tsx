import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetSchemasStore, useSchemasStore } from "@/store/schemas"
import { useTabsStore } from "@/store/tabs"
import { FilesPanel } from "./files-panel.js"

// Popover uses portals — render inline so we can assert on its content
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="popover">{children}</div> : null,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Dialog uses portals too
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

beforeEach(() => {
  localStorage.clear()
  useTabsStore.setState({ tabs: [], activeWorkflowId: null, activeCodeId: null })
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch not available in tests")))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("FilesPanel core nodes", () => {
  const schema = (name: string, category?: string, renamedTo?: string) => ({
    name,
    inputs: { type: "object" },
    outputs: { type: "object" },
    ...(category && { category }),
    ...(renamedTo && { renamedTo }),
  })
  beforeEach(() => {
    useSchemasStore.setState({
      loaded: true,
      schemas: {
        "@core/http-request": schema("HTTP Request", "triggers"),
        "@core/switch": schema("Switch", "logic"),
        "@core/if": schema("If / Else", "logic"),
        "@core/http-response": schema("HTTP Response", "responses"),
        "@core/response": schema("HTTP Response", "responses", "@core/http-response"),
        "./nodes/shared/parseBody": schema("Parse Body"),
      },
    })
  })
  afterEach(() => resetSchemasStore())

  it("lists built-in nodes in a core folder, one subfolder per category", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    fireEvent.click(screen.getByText("core"))
    const folders = ["triggers", "logic", "responses"]
    for (const f of folders) expect(screen.getByText(f)).toBeInTheDocument()
    // Triggers come first, then logic, then responses.
    const order = folders.map((f) => screen.getByText(f))
    expect(order[0]!.compareDocumentPosition(order[1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(order[1]!.compareDocumentPosition(order[2]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    fireEvent.click(screen.getByText("responses"))
    // The old @core/response name isn't listed a second time.
    expect(screen.getAllByText("HTTP Response")).toHaveLength(1)
  })

  it("drags a core node onto the canvas by its uses", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    fireEvent.click(screen.getByText("core"))
    fireEvent.click(screen.getByText("logic"))
    const leaf = screen.getByTestId("core-node-@core/switch")
    expect(leaf).toHaveTextContent("Switch")
    const dataTransfer = { setData: vi.fn(), effectAllowed: "" as string }
    fireEvent.dragStart(leaf, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith("application/lorien-node", "@core/switch")
  })
})

describe("FilesPanel", () => {
  it("renders the WORKFLOWS and NODES section headers (fallback mode)", async () => {
    render(<FilesPanel />)
    await waitFor(() => {
      expect(screen.getByText("WORKFLOWS")).toBeInTheDocument()
      expect(screen.getByText("NODES")).toBeInTheDocument()
    })
  })

  it("clicking a file leaf opens it as a tab", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    fireEvent.click(screen.getByText("shared"))
    const link = screen.getByText("parseBody.ts")
    fireEvent.click(link)
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().tabs[0]?.id).toBe("nodes/shared/parseBody.ts")
    expect(useTabsStore.getState().activeCodeId).toBe("nodes/shared/parseBody.ts")
  })

  it("dragging a .ts node leaf sets the correct dataTransfer payload", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    fireEvent.click(screen.getByText("shared"))
    const leaf = screen.getByText("parseBody.ts").closest("button")!
    const dataTransferMock = { setData: vi.fn(), effectAllowed: "" as string }
    fireEvent.dragStart(leaf, { dataTransfer: dataTransferMock })
    expect(dataTransferMock.setData).toHaveBeenCalledWith(
      "application/lorien-node",
      "./nodes/shared/parseBody",
    )
  })
})

describe("FilesPanel — right-click context menu (fallback disabled)", () => {
  it("right-clicking a folder while in fallback mode does not open the menu", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    const folder = screen.getByText("shared").closest("button")!
    fireEvent.contextMenu(folder)
    // In fallback mode we don't open the menu — creating against mock data would
    // silently fail to persist.
    expect(screen.queryByTestId("popover")).not.toBeInTheDocument()
  })
})

describe("FilesPanel — right-click context menu (ready)", () => {
  beforeEach(() => {
    // Override the global fetch stub so the workspace tree resolves successfully.
    const tree = {
      workflows: {
        type: "folder",
        id: "wf",
        name: "workflows",
        children: [
          {
            type: "folder",
            id: "wf-users",
            name: "users",
            children: [
              {
                type: "file",
                id: "wf-users-create",
                name: "create.workflow",
                kind: "workflow",
                path: "workflows/users/create.workflow",
              },
            ],
          },
        ],
      },
      nodes: {
        type: "folder",
        id: "n",
        name: "nodes",
        children: [],
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.endsWith("/api/workspace/tree")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(tree),
          })
        }
        return Promise.reject(new Error("unexpected fetch"))
      }),
    )
  })

  it("right-clicking a folder opens the workflows context menu", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument())
    const folder = screen.getByText("users").closest("button")!
    fireEvent.contextMenu(folder)
    await waitFor(() => {
      expect(screen.getByText(/New folder/)).toBeInTheDocument()
      expect(screen.getByText(/New workflow/)).toBeInTheDocument()
    })
  })

  it("right-clicking a file uses the file's parent folder as target", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("create.workflow")).toBeInTheDocument())
    fireEvent.contextMenu(screen.getByText("create.workflow").closest("button")!)
    fireEvent.click(screen.getByText(/New workflow/))
    // Dialog now open with defaultFolder = "workflows/users"
    await waitFor(() => {
      expect(screen.getByText("workflows/users")).toBeInTheDocument()
    })
  })

  it("right-clicking empty space in the WORKFLOWS section uses workflows root", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("WORKFLOWS")).toBeInTheDocument())
    const section = screen.getByText("WORKFLOWS").parentElement!
    fireEvent.contextMenu(section)
    fireEvent.click(screen.getByText(/New workflow/))
    await waitFor(() => {
      expect(screen.getByText("workflows")).toBeInTheDocument()
    })
  })

  it("right-clicking empty space in the NODES section shows New node option", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("NODES")).toBeInTheDocument())
    const section = screen.getByText("NODES").parentElement!
    fireEvent.contextMenu(section)
    await waitFor(() => {
      expect(screen.getByText(/New folder/)).toBeInTheDocument()
      expect(screen.getByText(/New node/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/New workflow/)).not.toBeInTheDocument()
  })
})

describe("FilesPanel — providers and lib", () => {
  const folder = (name: string, children: unknown[] = []) => ({
    type: "folder",
    id: name,
    name,
    children,
  })
  beforeEach(() => {
    const tree = {
      workflows: folder("workflows"),
      nodes: folder("nodes"),
      providers: folder("providers", [
        { type: "file", id: "p-db", name: "db.ts", kind: "provider", path: "providers/db.ts" },
      ]),
      lib: folder("lib"),
    }
    const providers = {
      providers: [
        {
          name: "db",
          path: "providers/db.ts",
          lifetime: "singleton",
          color: "sky",
          uses: [],
          env: [],
          hasDispose: false,
          packages: [],
          usedBy: [],
        },
      ],
      nodes: {},
    }
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const json = (body: unknown) =>
          Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
        if (url.endsWith("/api/workspace/tree")) return json(tree)
        if (url.endsWith("/api/workspace/providers")) return json(providers)
        if (init?.method === "PUT") return json({ path: "x", bytes: 1 })
        return Promise.reject(new Error("unexpected fetch"))
      }),
    )
  })

  it("lists providers with their lifetime and hints at an empty lib", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("db.ts")).toBeInTheDocument())
    expect(screen.getByText("PROVIDERS")).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText("singleton")).toBeInTheDocument())
    expect(screen.getByText("Shared helpers and types.")).toBeInTheDocument()
  })

  it("opens a provider as a code tab and never drags it onto the canvas", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("db.ts")).toBeInTheDocument())
    const leaf = screen.getByText("db.ts").closest("button")!
    expect(leaf).toHaveAttribute("draggable", "false")
    fireEvent.click(leaf)
    expect(useTabsStore.getState().activeCodeId).toBe("providers/db.ts")
  })

  it("creates a provider from the section's + button", async () => {
    render(<FilesPanel />)
    await waitFor(() => expect(screen.getByText("db.ts")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: "New provider" }))
    fireEvent.change(screen.getByLabelText("Selector"), { target: { value: "http-client" } })
    expect(screen.getByText(`providers["http-client"]`)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Scoped"))
    fireEvent.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() =>
      expect(useTabsStore.getState().activeCodeId).toBe("providers/http-client.ts"),
    )
    const put = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")!
    expect(put[0]).toContain(encodeURIComponent("providers/http-client.ts"))
    expect((put[1] as RequestInit).body).toContain(`lifetime: "scoped"`)
    expect((put[1] as RequestInit).body).toContain(`selector: "http-client"`)
  })
})
