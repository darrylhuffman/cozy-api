import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => (
    <div data-testid={`handle-${type}-${id ?? "default"}`} />
  ),
  Position: { Left: "left", Right: "right" },
}))

import type { JsonSchema } from "@/lib/api"
import { VariableNode } from "./variable-node.js"

afterEach(cleanup)

function renderVariable(value: unknown, schema?: JsonSchema) {
  const onValueChange = vi.fn()
  render(
    <VariableNode
      data={{
        id: "setting",
        instance: { uses: "@core/variable", values: { value } },
        schema,
        targets: [{ nodeId: "Save", portId: "setting" }],
        onValueChange,
      }}
    />,
  )
  return onValueChange
}

describe("VariableNode", () => {
  it("shows its name, type, output handle and the input it feeds", () => {
    renderVariable("admin", { type: "string", enum: ["member", "admin"] })
    expect(screen.getByText("setting")).toBeTruthy()
    expect(screen.getByText("enum")).toBeTruthy()
    expect(screen.getByTestId("handle-source-value")).toBeTruthy()
    expect(screen.getByTestId("variable-footer").textContent).toBe("Feeds Save.setting")
  })

  it("picks enum values from a select", () => {
    const onChange = renderVariable("admin", { type: "string", enum: ["member", "admin"] })
    fireEvent.change(screen.getByLabelText("setting"), { target: { value: "0" } })
    expect(onChange).toHaveBeenCalledWith("member")
  })

  it("flips booleans with a switch", () => {
    const onChange = renderVariable(false, { type: "boolean" })
    fireEvent.click(screen.getByRole("switch", { name: "setting" }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it("shows a number's range and flags values outside it", () => {
    renderVariable(120, { type: "number", minimum: 0, maximum: 100 })
    expect(screen.getByText("0–100")).toBeTruthy()
    expect(screen.getByText("Must be at most 100")).toBeTruthy()
  })

  it("edits objects as JSON checked against the schema", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { city: { type: "string" }, zip: { type: "string" } },
      required: ["city"],
    }
    const onChange = renderVariable({ city: "Oslo" }, schema)
    expect(screen.getByText("Matches schema")).toBeTruthy()
    const editor = screen.getByLabelText("setting")
    fireEvent.change(editor, { target: { value: '{ "city": 4' } })
    expect(screen.getByText("Not valid JSON")).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(editor, { target: { value: '{ "zip": "0150" }' } })
    expect(onChange).toHaveBeenCalledWith({ zip: "0150" })
    expect(screen.getByText("City is required")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Reset to schema" }))
    expect(onChange).toHaveBeenLastCalledWith({ city: "", zip: "" })
  })

  it("says so when it feeds nothing", () => {
    render(<VariableNode data={{ id: "x", instance: { uses: "@core/variable" }, targets: [] }} />)
    expect(screen.getByTestId("variable-footer").textContent).toBe("Not connected to an input yet")
  })
})
