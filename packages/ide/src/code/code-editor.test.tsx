import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CodeEditor } from "./code-editor"

// Mock @monaco-editor/react — jsdom can't instantiate Monaco's full editor
vi.mock("@monaco-editor/react", () => ({
  default: ({ value, path }: { value: string; path: string }) => (
    <div data-testid="monaco-stub" data-path={path}>
      {value}
    </div>
  ),
}))

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation((_input) => {
    return Promise.resolve(
      new Response(JSON.stringify({ path: "nodes/foo.ts", content: "export const x = 1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CodeEditor", () => {
  it("shows loading state then renders Monaco with the file's content", async () => {
    render(<CodeEditor path="nodes/foo.ts" />)
    expect(screen.getByText(/Loading/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId("monaco-stub")).toBeInTheDocument())
    expect(screen.getByTestId("monaco-stub")).toHaveTextContent("export const x = 1")
    expect(screen.getByTestId("monaco-stub").getAttribute("data-path")).toBe("nodes/foo.ts")
  })

  it("shows an error if the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"))
    render(<CodeEditor path="nodes/bad.ts" />)
    await waitFor(() => expect(screen.getByText(/Error loading file/)).toBeInTheDocument())
  })
})
