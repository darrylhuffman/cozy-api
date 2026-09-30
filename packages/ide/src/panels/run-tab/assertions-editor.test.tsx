import type { Assertion } from "@darrylondil/lorien-runtime/requests"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { AssertionsEditor } from "./assertions-editor"
import type { CheckShapes } from "./check-paths"

const shapes: CheckShapes = {
  body: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        status: { type: "string", enum: ["available", "sold"] },
      },
    },
  },
  headers: ["x-total"],
  nodes: [
    {
      id: "ListPets",
      input: undefined,
      output: { type: "object", properties: { count: { type: "integer" } } },
    },
  ],
}

let latest: Assertion[] = []
function Harness({ initial }: { initial: Assertion[] }) {
  const [value, setValue] = useState(initial)
  latest = value
  return (
    <AssertionsEditor
      value={value}
      shapes={shapes}
      onChange={(v) => {
        latest = v
        setValue(v)
      }}
    />
  )
}

describe("AssertionsEditor", () => {
  afterEach(cleanup)

  it("picks a body field by clicking through the response's shape", () => {
    render(<Harness initial={[{ target: "status", op: "equals", value: 200 }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Pick a field" }))
    const picker = screen.getByTestId("check-picker")
    fireEvent.click(within(picker).getByRole("button", { name: "Expand [0]" }))
    fireEvent.click(within(picker).getByRole("button", { name: /^status/ }))
    expect(latest[0]).toEqual({
      target: "body",
      path: "[0].status",
      op: "equals",
      value: "available",
    })
    // An enum field gets its options, not a text box.
    fireEvent.change(screen.getByLabelText("Expected value"), { target: { value: "1" } })
    expect(latest[0]?.value).toBe("sold")
  })

  it("types only the index into an array", () => {
    render(<Harness initial={[{ target: "body", path: "[0].name", op: "equals", value: "Rex" }]} />)
    fireEvent.change(screen.getByLabelText("Index into the body"), { target: { value: "12" } })
    expect(latest[0]?.path).toBe("[12].name")
    // A string field keeps what's typed as a string.
    fireEvent.change(screen.getByLabelText("Expected value"), { target: { value: "42" } })
    expect(latest[0]?.value).toBe("42")
  })

  it("picks a node's output and a header", () => {
    render(<Harness initial={[{ target: "status", op: "equals", value: 200 }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Pick a field" }))
    let picker = screen.getByTestId("check-picker")
    fireEvent.click(within(picker).getByRole("button", { name: "Expand Nodes" }))
    fireEvent.click(within(picker).getByRole("button", { name: "Expand ListPets" }))
    fireEvent.click(within(picker).getByRole("button", { name: "Expand output" }))
    fireEvent.click(within(picker).getByRole("button", { name: /^count/ }))
    expect(latest[0]).toMatchObject({ target: "node", node: "ListPets", path: "output.count" })
    expect(screen.getByRole("option", { name: "is less than" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Pick a field" }))
    picker = screen.getByTestId("check-picker")
    fireEvent.click(within(picker).getByRole("button", { name: "Expand Headers" }))
    fireEvent.click(within(picker).getByRole("button", { name: /^x-total/ }))
    expect(latest[0]).toMatchObject({ target: "header", path: "x-total" })
    expect(latest[0]?.node).toBeUndefined()
  })

  it("can still take a typed path", () => {
    render(<Harness initial={[{ target: "body", op: "exists" }]} />)
    fireEvent.click(screen.getByRole("button", { name: "Pick a field" }))
    fireEvent.change(screen.getByLabelText("Type a path"), { target: { value: "meta.page" } })
    fireEvent.click(screen.getByRole("button", { name: "Use path" }))
    expect(latest[0]).toEqual({ target: "body", path: "meta.page", op: "exists" })
  })
})
