import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, language }: { value: string; language: string }) => (
    <pre data-testid="monaco-mock" data-language={language}>
      {value}
    </pre>
  ),
}))

import { languageForContentType, ResponseBody } from "./response-body"

describe("ResponseBody", () => {
  afterEach(cleanup)

  it("shows JSON as a tree with only its top level open", () => {
    render(<ResponseBody body={{ id: 7, pet: { name: "Rex", tags: ["a"] }, ok: true }} />)
    const tree = screen.getByTestId("response-tree")
    expect(tree.textContent).toContain("id:7")
    expect(tree.textContent).toContain("pet:{ 2 }")
    expect(tree.textContent).not.toContain("Rex")
    fireEvent.click(screen.getByRole("button", { name: /^pet/ }))
    expect(tree.textContent).toContain('name:"Rex"')
    expect(tree.textContent).toContain("tags:[ 1 ]")
  })

  it("switches JSON to a raw, highlighted view", () => {
    render(<ResponseBody body={[1, 2]} />)
    fireEvent.click(screen.getByRole("tab", { name: "Raw" }))
    const raw = screen.getByTestId("monaco-mock")
    expect(raw.getAttribute("data-language")).toBe("json")
    expect(raw.textContent).toBe("[\n  1,\n  2\n]")
  })

  it("shows anything else raw, with no tabs", () => {
    render(<ResponseBody body="<p>hi</p>" contentType="text/html; charset=utf-8" />)
    expect(screen.queryByRole("tab")).toBeNull()
    expect(screen.getByTestId("monaco-mock").getAttribute("data-language")).toBe("html")
    expect(languageForContentType("application/problem+json")).toBe("json")
    expect(languageForContentType(undefined)).toBe("plaintext")
  })
})
