import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { FileFolder } from "@/data/mock-files"
import { middlewareTemplate, NewMiddlewareDialog } from "./new-middleware-dialog"

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const tree: FileFolder = {
  type: "folder",
  id: "wf",
  name: "workflows",
  children: [{ type: "folder", id: "wf-admin", name: "admin", children: [] }],
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("NewMiddlewareDialog", () => {
  it("writes _middleware.ts into the chosen folder", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal("fetch", fetchMock)
    const onCreated = vi.fn()
    render(
      <NewMiddlewareDialog
        open
        onOpenChange={() => {}}
        onCreated={onCreated}
        defaultFolder="workflows/admin"
        workflowsTree={tree}
      />,
    )
    expect(screen.getByText("workflows/admin/_middleware.ts")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("workflows/admin/_middleware.ts"))
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toContain(encodeURIComponent("workflows/admin/_middleware.ts"))
    expect((init as RequestInit).body).toContain("defineMiddleware")
  })

  it("opens the folder's existing middleware instead of failing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({}) }),
    )
    const onCreated = vi.fn()
    render(
      <NewMiddlewareDialog
        open
        onOpenChange={() => {}}
        onCreated={onCreated}
        workflowsTree={tree}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("workflows/_middleware.ts"))
  })

  it("says which routes the starter guards", () => {
    expect(middlewareTemplate("workflows")).toContain("Runs before every route,")
    expect(middlewareTemplate("workflows/admin")).toContain("every route in workflows/admin/")
  })
})
