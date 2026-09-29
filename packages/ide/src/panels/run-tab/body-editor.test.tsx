import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { useDebugSessionStore } from "@/store/debug-session"

// Mock @monaco-editor/react BEFORE importing BodyEditor so the mock module is hot.
vi.mock("@monaco-editor/react", () => ({
  default: (props: {
    defaultLanguage?: string
    value?: string
    height?: number | string
  }) => (
    <div
      data-testid="monaco-mock"
      data-language={props.defaultLanguage}
      data-value={props.value ?? ""}
      data-height={String(props.height ?? "")}
    />
  ),
}))

import { BodyEditor } from "./body-editor"

describe("BodyEditor", () => {
  afterEach(() => {
    cleanup()
    useDebugSessionStore.setState(useDebugSessionStore.getState().getInitialState())
  })

  it("renders nothing for bodyKind='none'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({ ...c, bodyKind: "none" }))
    const { container } = render(<BodyEditor />)
    expect(container).toBeEmptyDOMElement()
  })

  it("renders Monaco with defaultLanguage='json' for bodyKind='json'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({
      ...c,
      bodyKind: "json",
      body: '{ "a": 1 }',
    }))
    render(<BodyEditor />)
    const ed = screen.getByTestId("monaco-mock")
    expect(ed).toHaveAttribute("data-language", "json")
    expect(ed).toHaveAttribute("data-value", '{ "a": 1 }')
  })

  it("renders Monaco with defaultLanguage='xml' for bodyKind='xml'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({ ...c, bodyKind: "xml" }))
    render(<BodyEditor />)
    expect(screen.getByTestId("monaco-mock")).toHaveAttribute("data-language", "xml")
  })

  it("renders Monaco with defaultLanguage='plaintext' for bodyKind='text'", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({ ...c, bodyKind: "text" }))
    render(<BodyEditor />)
    expect(screen.getByTestId("monaco-mock")).toHaveAttribute("data-language", "plaintext")
  })

  it("renders KeyValueGrid for bodyKind='form' with current formBody rows", () => {
    useDebugSessionStore.getState().setRequestForm((c) => ({
      ...c,
      bodyKind: "form",
      formBody: [["x", "1"], ["y", "2"]],
    }))
    render(<BodyEditor />)
    // KeyValueGrid renders one row per pair with the value in an input.
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[]
    const values = inputs.map((i) => i.value)
    expect(values).toContain("x")
    expect(values).toContain("1")
    expect(values).toContain("y")
    expect(values).toContain("2")
  })
})
