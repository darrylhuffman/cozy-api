import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import { RequestBuilder } from "./request-builder"

// Some upstream effects fetch schemas; mock it to avoid network noise.
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api")
  return { ...actual, fetchWorkspaceSchemas: vi.fn().mockResolvedValue({}) }
})

describe("RequestBuilder method UI", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(
      useDebugSessionStore.getState().getInitialState() as never,
    )
  })

  it("does not render a method <select>", () => {
    useDebugSessionStore.getState().setRequestForm(() => ({
      triggerNodeId: "Request",
      method: "POST",
      path: "/users",
      bodyKind: "none",
      body: "",
      formBody: [],
      query: [],
      headers: [],
    }))
    const { container } = render(<RequestBuilder />)
    expect(container.querySelector("select")).toBeNull()
  })

  it("renders the method as a read-only badge", () => {
    useDebugSessionStore.getState().setRequestForm(() => ({
      triggerNodeId: "Request",
      method: "POST",
      path: "/users",
      bodyKind: "none",
      body: "",
      formBody: [],
      query: [],
      headers: [],
    }))
    render(<RequestBuilder />)
    const badge = screen.getByTestId("request-method")
    expect(badge.textContent).toBe("POST")
    expect(badge.tagName.toLowerCase()).toBe("span")
  })
})
