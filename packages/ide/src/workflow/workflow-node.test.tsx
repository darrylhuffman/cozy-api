import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mock @xyflow/react — Handle and Position only
vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => (
    <div data-testid={`handle-${type}-${id ?? "default"}`} />
  ),
  Position: { Left: "left", Right: "right" },
}))

import type { NodeInstance } from "@/lib/api"
import type { NodePorts, PortNode } from "./derive-ports.js"
import { WorkflowNode } from "./workflow-node.js"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Convenience: build a leaf PortNode. */
const leaf = (name: string, idOverride?: string): PortNode => ({
  id: idOverride ?? name,
  label: name,
  children: [],
  isLeaf: true,
})

/** Convenience: build a branch PortNode. */
const branch = (name: string, children: PortNode[], idOverride?: string): PortNode => ({
  id: idOverride ?? name,
  label: name,
  children,
  isLeaf: false,
})

function makeData(id: string, instance: NodeInstance, ports: NodePorts): Record<string, unknown> {
  return { id, instance, ports }
}

describe("WorkflowNode", () => {
  it("renders node id as display name when no label is set", () => {
    const data = makeData("myNode", { uses: "./nodes/myNode" }, { inputs: [], outputs: [] })
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
    const data = makeData("request", { uses: "@core/http-request" }, { inputs: [], outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("core")).toBeInTheDocument()
  })

  it("shows 'node' kind label for ./ nodes", () => {
    const data = makeData("save", { uses: "./nodes/save" }, { inputs: [], outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("node")).toBeInTheDocument()
  })

  it("shows 'external' kind label for other uses", () => {
    const data = makeData("ext", { uses: "some-package/node" }, { inputs: [], outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("external")).toBeInTheDocument()
  })

  it("renders uses path in footer", () => {
    const data = makeData("save", { uses: "./nodes/users/save-user" }, { inputs: [], outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("./nodes/users/save-user")).toBeInTheDocument()
  })

  it("renders input port labels on the left", () => {
    const ports: NodePorts = {
      inputs: [leaf("email"), leaf("password")],
      outputs: [],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("email")).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()
    expect(screen.getByTestId("handle-target-email")).toBeInTheDocument()
    expect(screen.getByTestId("handle-target-password")).toBeInTheDocument()
  })

  it("renders output port labels on the right", () => {
    const ports: NodePorts = {
      inputs: [],
      outputs: [leaf("user")],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("user")).toBeInTheDocument()
    expect(screen.getByTestId("handle-source-user")).toBeInTheDocument()
  })

  it("renders both input and output ports simultaneously", () => {
    const ports: NodePorts = {
      inputs: [leaf("email"), leaf("password")],
      outputs: [leaf("user")],
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
    expect(screen.getByText("request")).toBeInTheDocument()
    expect(screen.queryByTestId(/^handle-target/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^handle-source/)).not.toBeInTheDocument()
  })

  it("uses graceful fallback when ports is undefined", () => {
    const data: Record<string, unknown> = {
      id: "legacy",
      instance: { uses: "@core/http-request" },
    }
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("legacy")).toBeInTheDocument()
  })

  describe("expandable port tree", () => {
    const userBranch = branch("user", [leaf("id", "user.id"), leaf("email", "user.email")])

    it("renders branch ports with a chevron, children hidden by default", () => {
      const ports: NodePorts = { inputs: [], outputs: [userBranch] }
      const data = makeData("save", { uses: "./nodes/save" }, ports)
      render(<WorkflowNode data={data} />)
      expect(screen.getByText("user")).toBeInTheDocument()
      // Chevron present
      expect(screen.getByTestId("chevron-user")).toBeInTheDocument()
      // Children not rendered yet
      expect(screen.queryByText("id")).not.toBeInTheDocument()
      expect(screen.queryByText("email")).not.toBeInTheDocument()
      // The branch handle exists at the root level
      expect(screen.getByTestId("handle-source-user")).toBeInTheDocument()
    })

    it("clicking the chevron expands and reveals leaf children", () => {
      const ports: NodePorts = { inputs: [], outputs: [userBranch] }
      const data = makeData("save", { uses: "./nodes/save" }, ports)
      render(<WorkflowNode data={data} />)

      fireEvent.click(screen.getByTestId("chevron-user"))

      expect(screen.getByText("id")).toBeInTheDocument()
      expect(screen.getByText("email")).toBeInTheDocument()
      // Each expanded child has its own Handle
      expect(screen.getByTestId("handle-source-user.id")).toBeInTheDocument()
      expect(screen.getByTestId("handle-source-user.email")).toBeInTheDocument()
    })

    it("clicking the chevron a second time collapses back", () => {
      const ports: NodePorts = { inputs: [], outputs: [userBranch] }
      const data = makeData("save", { uses: "./nodes/save" }, ports)
      render(<WorkflowNode data={data} />)
      const chevron = screen.getByTestId("chevron-user")
      fireEvent.click(chevron)
      expect(screen.getByText("id")).toBeInTheDocument()
      fireEvent.click(chevron)
      expect(screen.queryByText("id")).not.toBeInTheDocument()
    })

    it("supports branch inputs on the left with chevrons", () => {
      const ports: NodePorts = {
        inputs: [branch("payload", [leaf("name", "payload.name")])],
        outputs: [],
      }
      const data = makeData("save", { uses: "./nodes/save" }, ports)
      render(<WorkflowNode data={data} />)
      expect(screen.getByText("payload")).toBeInTheDocument()
      expect(screen.getByTestId("chevron-payload")).toBeInTheDocument()
      expect(screen.getByTestId("handle-target-payload")).toBeInTheDocument()

      fireEvent.click(screen.getByTestId("chevron-payload"))
      expect(screen.getByText("name")).toBeInTheDocument()
      expect(screen.getByTestId("handle-target-payload.name")).toBeInTheDocument()
    })

    it("handles deeply nested expansion (3 levels)", () => {
      const deep = branch("body", [branch("user", [leaf("name", "body.user.name")], "body.user")])
      const ports: NodePorts = { inputs: [], outputs: [deep] }
      const data = makeData("req", { uses: "@core/http-request" }, ports)
      render(<WorkflowNode data={data} />)

      fireEvent.click(screen.getByTestId("chevron-body"))
      expect(screen.getByText("user")).toBeInTheDocument()
      fireEvent.click(screen.getByTestId("chevron-body.user"))
      expect(screen.getByText("name")).toBeInTheDocument()
      expect(screen.getByTestId("handle-source-body.user.name")).toBeInTheDocument()
    })
  })
})
