import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"
import { BodyTypeTabs } from "./body-type-tabs"

describe("BodyTypeTabs", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("renders five tab buttons", () => {
    render(<BodyTypeTabs />)
    expect(screen.getByRole("button", { name: "JSON" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "XML" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Text" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Form" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "None" })).toBeInTheDocument()
  })

  it("clicking a tab updates requestForm.bodyKind", () => {
    render(<BodyTypeTabs />)
    fireEvent.click(screen.getByRole("button", { name: "JSON" }))
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("json")
    fireEvent.click(screen.getByRole("button", { name: "XML" }))
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("xml")
    fireEvent.click(screen.getByRole("button", { name: "Form" }))
    expect(useDebugSessionStore.getState().requestForm.bodyKind).toBe("form")
  })

  it("the active tab has a distinct aria-pressed='true'", () => {
    useDebugSessionStore.getState().setRequestForm((cur) => ({ ...cur, bodyKind: "xml" }))
    render(<BodyTypeTabs />)
    expect(screen.getByRole("button", { name: "XML" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "false")
  })

  describe("Content-Type auto-set", () => {
    it("adds Content-Type when headers is empty and a kind is picked", () => {
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "JSON" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/json"],
      ])
    })

    it("replaces an auto-set Content-Type with the new kind's value", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "XML" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/xml"],
      ])
    })

    it("leaves a manually-overridden Content-Type untouched", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/vnd.api+json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "XML" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/vnd.api+json"],
      ])
    })

    it("removes an auto-set Content-Type when picking None", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "None" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([])
    })

    it("does NOT remove a manually-overridden Content-Type when picking None", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["Content-Type", "application/vnd.api+json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "None" }))
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["Content-Type", "application/vnd.api+json"],
      ])
    })

    it("matches Content-Type header key case-insensitively", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "json",
        headers: [["content-type", "application/json"]],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "XML" }))
      // The original case is preserved; only the value changes
      expect(useDebugSessionStore.getState().requestForm.headers).toEqual([
        ["content-type", "application/xml"],
      ])
    })

    it("preserves other headers untouched", () => {
      useDebugSessionStore.getState().setRequestForm((cur) => ({
        ...cur,
        bodyKind: "none",
        headers: [
          ["Authorization", "Bearer tok"],
          ["X-Trace", "abc"],
        ],
      }))
      render(<BodyTypeTabs />)
      fireEvent.click(screen.getByRole("button", { name: "JSON" }))
      const headers = useDebugSessionStore.getState().requestForm.headers
      expect(headers).toContainEqual(["Authorization", "Bearer tok"])
      expect(headers).toContainEqual(["X-Trace", "abc"])
      expect(headers).toContainEqual(["Content-Type", "application/json"])
    })
  })
})
