import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mock @xyflow/react — Handle and Position only
vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => (
    <div data-testid={`handle-${type}-${id ?? "default"}`} />
  ),
  Position: { Left: "left", Right: "right" },
}))

import type { NodeInstance } from "@/lib/api"
import type { NodePorts } from "./derive-ports.js"
import { WorkflowNode } from "./workflow-node.js"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function makeData(
  id: string,
  instance: NodeInstance,
  ports: NodePorts,
): Record<string, unknown> {
  return { id, instance, ports }
}

describe("WorkflowNode", () => {
  it("renders node id as display name when no label is set", () => {
    const data = makeData(
      "myNode",
      { uses: "./nodes/myNode" },
      { inputs: [], outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("myNode")).toBeInTheDocument()
  })

  it("renders label when instance.label is set", () => {
    const data = makeData(
      "myNode",
      { uses: "./nodes/myNode", label: "My Custom Label" },
      { inputs: [], outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("My Custom Label")).toBeInTheDocument()
  })

  it("shows 'core' kind label for @core/ nodes", () => {
    const data = makeData(
      "request",
      { uses: "@core/http-request" },
      { inputs: [], outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("core")).toBeInTheDocument()
  })

  it("shows 'node' kind label for ./ nodes", () => {
    const data = makeData(
      "save",
      { uses: "./nodes/save" },
      { inputs: [], outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("node")).toBeInTheDocument()
  })

  it("shows 'external' kind label for other uses", () => {
    const data = makeData(
      "ext",
      { uses: "some-package/node" },
      { inputs: [], outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("external")).toBeInTheDocument()
  })

  it("renders uses path in footer", () => {
    const data = makeData(
      "save",
      { uses: "./nodes/users/save-user" },
      { inputs: [], outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("./nodes/users/save-user")).toBeInTheDocument()
  })

  it("renders input port labels on the left", () => {
    const ports: NodePorts = {
      inputs: [
        { id: "email", label: "email" },
        { id: "password", label: "password" },
      ],
      outputs: [],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("email")).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()
    // Corresponding target handles rendered
    expect(screen.getByTestId("handle-target-email")).toBeInTheDocument()
    expect(screen.getByTestId("handle-target-password")).toBeInTheDocument()
  })

  it("renders output port labels on the right", () => {
    const ports: NodePorts = {
      inputs: [],
      outputs: [
        { id: "user", label: "user" },
      ],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("user")).toBeInTheDocument()
    expect(screen.getByTestId("handle-source-user")).toBeInTheDocument()
  })

  it("renders both input and output ports simultaneously", () => {
    const ports: NodePorts = {
      inputs: [
        { id: "email", label: "email" },
        { id: "password", label: "password" },
      ],
      outputs: [{ id: "user", label: "user" }],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("email")).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()
    expect(screen.getByText("user")).toBeInTheDocument()
  })

  it("renders correctly with zero ports (trigger node)", () => {
    const ports: NodePorts = { inputs: [], outputs: [] }
    const data = makeData("request", { uses: "@core/http-request" }, ports)
    render(<WorkflowNode data={data} />)
    // Should not error; node id is rendered
    expect(screen.getByText("request")).toBeInTheDocument()
    // No handles rendered (only default-handle stubs absent when id is undefined)
    expect(screen.queryByTestId(/^handle-target/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^handle-source/)).not.toBeInTheDocument()
  })

  it("uses graceful fallback when ports is undefined", () => {
    // Simulate old-format data without ports field
    const data: Record<string, unknown> = {
      id: "legacy",
      instance: { uses: "@core/http-request" },
      // ports intentionally omitted
    }
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("legacy")).toBeInTheDocument()
  })
})
