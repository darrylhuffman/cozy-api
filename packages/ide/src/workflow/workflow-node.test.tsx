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

/** Empty root input port — used for nodes with no inputs (triggers). */
const emptyInputRoot: PortNode = { id: "", label: "input", children: [], isLeaf: true }
/** Builds a root input port whose children are the given top-level ports. */
const inputRoot = (children: PortNode[]): PortNode => ({
  id: "",
  label: "input",
  children,
  isLeaf: false,
})

describe("WorkflowNode", () => {
  it("renders node id as display name when no label is set", () => {
    const data = makeData("myNode", { uses: "./nodes/myNode" }, { inputs: emptyInputRoot, outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("myNode")).toBeInTheDocument()
  })

  it("renders label when instance.label is set", () => {
    const data = makeData(
      "myNode",
      { uses: "./nodes/myNode", label: "My Custom Label" },
      { inputs: emptyInputRoot, outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("My Custom Label")).toBeInTheDocument()
  })

  it("shows 'core' kind label for @core/ nodes", () => {
    const data = makeData("request", { uses: "@core/http-request" }, { inputs: emptyInputRoot, outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("core")).toBeInTheDocument()
  })

  it("shows 'node' kind label for ./ nodes", () => {
    const data = makeData("save", { uses: "./nodes/save" }, { inputs: emptyInputRoot, outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("node")).toBeInTheDocument()
  })

  it("shows 'external' kind label for other uses", () => {
    const data = makeData("ext", { uses: "some-package/node" }, { inputs: emptyInputRoot, outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("external")).toBeInTheDocument()
  })

  it("renders uses path in footer", () => {
    const data = makeData("save", { uses: "./nodes/users/save-user" }, { inputs: emptyInputRoot, outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("./nodes/users/save-user")).toBeInTheDocument()
  })

  it("renders input port labels on the left (expand root to see fields)", () => {
    const ports: NodePorts = {
      inputs: inputRoot([leaf("email"), leaf("password")]),
      outputs: [],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    // Root branch labeled "input" is visible
    expect(screen.getByText("input")).toBeInTheDocument()
    // The synthetic root has an empty-string handle id
    expect(screen.getByTestId("handle-target-")).toBeInTheDocument()
    // Fields hidden until the root chevron is expanded
    expect(screen.queryByText("email")).not.toBeInTheDocument()

    // Expand the root chevron — testid is `chevron-` (root has empty id)
    fireEvent.click(screen.getByTestId("chevron-"))
    expect(screen.getByText("email")).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()
    expect(screen.getByTestId("handle-target-email")).toBeInTheDocument()
    expect(screen.getByTestId("handle-target-password")).toBeInTheDocument()
  })

  it("renders output port labels on the right", () => {
    const ports: NodePorts = {
      inputs: emptyInputRoot,
      outputs: [leaf("user")],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("user")).toBeInTheDocument()
    expect(screen.getByTestId("handle-source-user")).toBeInTheDocument()
  })

  it("renders both input root and output ports simultaneously", () => {
    const ports: NodePorts = {
      inputs: inputRoot([leaf("email"), leaf("password")]),
      outputs: [leaf("user")],
    }
    const data = makeData("save", { uses: "./nodes/save" }, ports)
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("input")).toBeInTheDocument()
    expect(screen.getByText("user")).toBeInTheDocument()
    fireEvent.click(screen.getByTestId("chevron-"))
    expect(screen.getByText("email")).toBeInTheDocument()
    expect(screen.getByText("password")).toBeInTheDocument()
  })

  it("renders correctly with zero ports (trigger node)", () => {
    const ports: NodePorts = { inputs: emptyInputRoot, outputs: [] }
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
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [userBranch] }
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
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [userBranch] }
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
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [userBranch] }
      const data = makeData("save", { uses: "./nodes/save" }, ports)
      render(<WorkflowNode data={data} />)
      const chevron = screen.getByTestId("chevron-user")
      fireEvent.click(chevron)
      expect(screen.getByText("id")).toBeInTheDocument()
      fireEvent.click(chevron)
      expect(screen.queryByText("id")).not.toBeInTheDocument()
    })

    it("supports branch inputs on the left (root branch wrapping a deeper branch)", () => {
      const ports: NodePorts = {
        inputs: inputRoot([branch("payload", [leaf("name", "payload.name")])]),
        outputs: [],
      }
      const data = makeData("save", { uses: "./nodes/save" }, ports)
      render(<WorkflowNode data={data} />)
      // Root branch is "input" with a chevron; the synthetic root handle id is ""
      expect(screen.getByText("input")).toBeInTheDocument()
      expect(screen.getByTestId("chevron-")).toBeInTheDocument()
      expect(screen.getByTestId("handle-target-")).toBeInTheDocument()

      // Expand root → reveals the "payload" branch
      fireEvent.click(screen.getByTestId("chevron-"))
      expect(screen.getByText("payload")).toBeInTheDocument()
      expect(screen.getByTestId("chevron-payload")).toBeInTheDocument()
      expect(screen.getByTestId("handle-target-payload")).toBeInTheDocument()

      // Expand "payload" → reveals "name"
      fireEvent.click(screen.getByTestId("chevron-payload"))
      expect(screen.getByText("name")).toBeInTheDocument()
      expect(screen.getByTestId("handle-target-payload.name")).toBeInTheDocument()
    })

    it("handles deeply nested expansion (3 levels)", () => {
      const deep = branch("body", [branch("user", [leaf("name", "body.user.name")], "body.user")])
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [deep] }
      const data = makeData("req", { uses: "@core/http-request" }, ports)
      render(<WorkflowNode data={data} />)

      fireEvent.click(screen.getByTestId("chevron-body"))
      expect(screen.getByText("user")).toBeInTheDocument()
      fireEvent.click(screen.getByTestId("chevron-body.user"))
      expect(screen.getByText("name")).toBeInTheDocument()
      expect(screen.getByTestId("handle-source-body.user.name")).toBeInTheDocument()
    })
  })

  describe("smart default expansion (controlled via props)", () => {
    it("input root collapsed by default when all required fields are bound", () => {
      const ports: NodePorts = {
        inputs: inputRoot([leaf("email"), leaf("password")]),
        outputs: [],
      }
      const data: Record<string, unknown> = {
        id: "save",
        instance: {
          uses: "./save",
          in: {
            email: "request.body.email",
            password: "request.body.password",
          },
        },
        ports,
        // Editor passes empty sets when satisfaction is full.
        expandedInputs: new Set<string>(),
        expandedOutputs: new Set<string>(),
        onTogglePort: () => {},
      }
      render(<WorkflowNode data={data} />)
      // Children not visible because root isn't in the expanded set.
      expect(screen.queryByText("email")).not.toBeInTheDocument()
      expect(screen.queryByText("password")).not.toBeInTheDocument()
    })

    it("input root expanded when partially or empty (editor seeds {''})", () => {
      const ports: NodePorts = {
        inputs: inputRoot([leaf("email"), leaf("password")]),
        outputs: [],
      }
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save", in: { email: "request.body.email" } },
        ports,
        expandedInputs: new Set([""]),
        expandedOutputs: new Set<string>(),
        onTogglePort: () => {},
      }
      render(<WorkflowNode data={data} />)
      // Children visible because root is in expanded set.
      expect(screen.getByText("email")).toBeInTheDocument()
      expect(screen.getByText("password")).toBeInTheDocument()
    })

    it("outputs are expanded by default (editor seeds branch paths)", () => {
      const userBranch = branch("user", [leaf("id", "user.id"), leaf("email", "user.email")])
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [userBranch] }
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save" },
        ports,
        expandedInputs: new Set<string>(),
        expandedOutputs: new Set(["user"]),
        onTogglePort: () => {},
      }
      render(<WorkflowNode data={data} />)
      expect(screen.getByText("id")).toBeInTheDocument()
      expect(screen.getByText("email")).toBeInTheDocument()
    })

    it("clicking the chevron delegates to onTogglePort when controlled", () => {
      const ports: NodePorts = {
        inputs: inputRoot([leaf("email")]),
        outputs: [],
      }
      const toggles: Array<{ side: string; id: string }> = []
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save" },
        ports,
        expandedInputs: new Set<string>(),
        expandedOutputs: new Set<string>(),
        onTogglePort: (side: string, id: string) => toggles.push({ side, id }),
      }
      render(<WorkflowNode data={data} />)
      fireEvent.click(screen.getByTestId("chevron-"))
      expect(toggles).toEqual([{ side: "input", id: "" }])
    })
  })

  describe("'+N more' overflow", () => {
    const many = (count: number): PortNode[] =>
      Array.from({ length: count }, (_, i) => leaf(`f${i}`))

    it("shows the first 6 children and a '+N more' button when count > 6", () => {
      // 10-children branch, force it expanded via uncontrolled local toggle.
      const big = branch("body", many(10))
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [big] }
      const data = makeData("req", { uses: "@core/http-request" }, ports)
      render(<WorkflowNode data={data} />)
      fireEvent.click(screen.getByTestId("chevron-body"))

      // First 6 visible
      for (let i = 0; i < 6; i++) {
        expect(screen.getByText(`f${i}`)).toBeInTheDocument()
      }
      // Last 4 NOT visible yet
      for (let i = 6; i < 10; i++) {
        expect(screen.queryByText(`f${i}`)).not.toBeInTheDocument()
      }
      // The "+4 more" button is present
      expect(screen.getByTestId("show-more-body")).toBeInTheDocument()
      expect(screen.getByText(/\+4 more/)).toBeInTheDocument()
    })

    it("clicking '+N more' reveals all hidden children", () => {
      const big = branch("body", many(10))
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [big] }
      const data = makeData("req", { uses: "@core/http-request" }, ports)
      render(<WorkflowNode data={data} />)
      fireEvent.click(screen.getByTestId("chevron-body"))
      fireEvent.click(screen.getByTestId("show-more-body"))

      for (let i = 0; i < 10; i++) {
        expect(screen.getByText(`f${i}`)).toBeInTheDocument()
      }
      // Button disappears once all are shown
      expect(screen.queryByTestId("show-more-body")).not.toBeInTheDocument()
    })

    it("no '+N more' button when count <= 6", () => {
      const small = branch("body", many(6))
      const ports: NodePorts = { inputs: emptyInputRoot, outputs: [small] }
      const data = makeData("req", { uses: "@core/http-request" }, ports)
      render(<WorkflowNode data={data} />)
      fireEvent.click(screen.getByTestId("chevron-body"))
      expect(screen.queryByTestId("show-more-body")).not.toBeInTheDocument()
    })
  })

  describe("color accent stripe", () => {
    it("renders a stripe when color is set on data", () => {
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save" },
        ports: { inputs: emptyInputRoot, outputs: [] },
        color: "#a78bfa",
      }
      render(<WorkflowNode data={data} />)
      const stripe = screen.getByTestId("accent-stripe")
      expect(stripe).toBeInTheDocument()
      expect(stripe.getAttribute("style")).toContain("background")
    })

    it("renders no stripe when color is missing", () => {
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save" },
        ports: { inputs: emptyInputRoot, outputs: [] },
      }
      render(<WorkflowNode data={data} />)
      expect(screen.queryByTestId("accent-stripe")).not.toBeInTheDocument()
    })
  })
})
