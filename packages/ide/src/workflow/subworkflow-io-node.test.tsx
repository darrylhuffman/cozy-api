import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => (
    <div data-testid={`handle-${type}-${id ?? "default"}`} />
  ),
  Position: { Left: "left", Right: "right" },
  useConnection: () => false,
}))

import type { NodeInstance, WorkflowFile } from "@/lib/api"
import { SubworkflowIoNode } from "./subworkflow-io-node"

afterEach(() => {
  cleanup()
})

const wf: WorkflowFile = {
  lorien: 1,
  nodes: {
    Input: {
      uses: "@core/input",
      values: { fields: { eventId: "string", spec: { type: "array" } } },
    },
    Find: { uses: "./nodes/find", in: { id: "Input.eventId" } },
    Output: { uses: "@core/output", in: { event: "Find.event" } },
  },
}

/** Renders a card whose edits apply to `wf`; returns what the last edit produced. */
function renderCard(id: "Input" | "Output") {
  const edits: (WorkflowFile | null)[] = []
  const onEdit = (fn: (w: WorkflowFile) => WorkflowFile | null) => edits.push(fn(wf))
  render(
    <SubworkflowIoNode
      data={{ id, instance: wf.nodes[id] as NodeInstance, onEdit } as Record<string, unknown>}
    />,
  )
  return () => edits.at(-1)
}

describe("SubworkflowIoNode — Input", () => {
  it("shows a row, a type and an output handle per field", () => {
    renderCard("Input")
    expect(screen.getByText("IN")).toBeTruthy()
    expect(screen.getByLabelText("Input name eventId")).toBeTruthy()
    expect((screen.getByLabelText("Type of eventId") as HTMLSelectElement).value).toBe("string")
    // A JSON Schema type isn't something the picker can show.
    expect(screen.queryByLabelText("Type of spec")).toBeNull()
    expect(screen.getByText("schema")).toBeTruthy()
    expect(screen.getByTestId("handle-source-eventId")).toBeTruthy()
  })

  it("adds, renames, retypes and removes inputs", () => {
    const last = renderCard("Input")
    fireEvent.click(screen.getByRole("button", { name: "Add input" }))
    expect(Object.keys(last()?.nodes.Input?.values?.fields as object)).toContain("input")

    const name = screen.getByLabelText("Input name eventId")
    fireEvent.change(name, { target: { value: "id" } })
    fireEvent.blur(name)
    expect(last()?.nodes.Find?.in).toEqual({ id: "Input.id" })

    fireEvent.change(screen.getByLabelText("Type of eventId"), { target: { value: "number" } })
    expect((last()?.nodes.Input?.values?.fields as Record<string, unknown>).eventId).toBe("number")

    fireEvent.click(screen.getByRole("button", { name: "Remove input eventId" }))
    expect(Object.keys(last()?.nodes.Input?.values?.fields as object)).toEqual(["spec"])
  })

  it("doesn't rename to a name that can't be referenced", () => {
    const last = renderCard("Input")
    const name = screen.getByLabelText("Input name eventId")
    fireEvent.change(name, { target: { value: "1st" } })
    fireEvent.blur(name)
    expect(last()).toBeUndefined()
    expect((name as HTMLInputElement).value).toBe("eventId")
  })
})

describe("SubworkflowIoNode — Output", () => {
  it("shows each output with what it reads, and a row to drop new ones on", () => {
    renderCard("Output")
    expect(screen.getByText("OUT")).toBeTruthy()
    expect(screen.getByLabelText("Output name event")).toBeTruthy()
    expect(screen.getByText("Find.event")).toBeTruthy()
    expect(screen.getByTestId("handle-target-event")).toBeTruthy()
    expect(screen.getByTestId("handle-target-$root")).toBeTruthy()
  })

  it("renames and removes outputs", () => {
    const last = renderCard("Output")
    const name = screen.getByLabelText("Output name event")
    fireEvent.change(name, { target: { value: "found" } })
    fireEvent.keyDown(name, { key: "Enter" })
    fireEvent.blur(name)
    expect(last()?.nodes.Output?.in).toEqual({ found: "Find.event" })
    fireEvent.click(screen.getByRole("button", { name: "Remove output event" }))
    expect(last()?.nodes.Output?.in).toBeUndefined()
  })
})
