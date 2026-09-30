import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mock @xyflow/react — Handle and Position only
vi.mock("@xyflow/react", () => ({
  Handle: ({ id, type }: { id?: string; type: string }) => (
    <div data-testid={`handle-${type}-${id ?? "default"}`} />
  ),
  Position: { Left: "left", Right: "right" },
}))

import type { NodeInstance } from "@/lib/api"
import { resetProvidersStore, useProvidersStore } from "@/store/providers"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import type { NodePorts, PortNode } from "./derive-ports.js"
import { WorkflowNode } from "./workflow-node.js"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // Reset selection store between tests
  useSelectionStore.getState().setSelected(null)
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

function makeData(
  id: string,
  instance: NodeInstance,
  ports: NodePorts,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id, instance, ports, ...extra }
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
  it("renders the name derived from `uses` when no label is set", () => {
    const data = makeData(
      "myNode",
      { uses: "./nodes/myNode" },
      { inputs: emptyInputRoot, outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("myNode")).toBeInTheDocument()
  })

  it("prefers schemaName from `defineNode({ name })` over the `uses`-derived name", () => {
    // Dropping a second `./nodes/users/save-user` produces id `save-user-2`.
    // The card header should read the schema's declared "Save User", not the
    // disambiguated technical id.
    const data = makeData(
      "save-user-2",
      { uses: "./nodes/users/save-user" },
      { inputs: emptyInputRoot, outputs: [] },
      { schemaName: "Save User" },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("Save User")).toBeInTheDocument()
    expect(screen.queryByText("save-user-2")).not.toBeInTheDocument()
    expect(screen.queryByText("save-user")).not.toBeInTheDocument()
  })

  it("falls back to the `uses`-derived name when no schemaName is provided", () => {
    const data = makeData(
      "save-user-2",
      { uses: "./nodes/users/save-user" },
      { inputs: emptyInputRoot, outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("save-user")).toBeInTheDocument()
    expect(screen.queryByText("save-user-2")).not.toBeInTheDocument()
  })

  it("instance.label takes precedence over schemaName", () => {
    const data = makeData(
      "save-user",
      { uses: "./nodes/users/save-user", label: "My Custom Label" },
      { inputs: emptyInputRoot, outputs: [] },
      { schemaName: "Save User" },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("My Custom Label")).toBeInTheDocument()
    expect(screen.queryByText("Save User")).not.toBeInTheDocument()
  })

  it("strips `@core/` and file extensions from the display name", () => {
    const data = makeData(
      "request",
      { uses: "@core/http-request" },
      { inputs: emptyInputRoot, outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    // Header shows the bare node name; the kind chip ("core") and footer
    // (`@core/http-request`) carry the prefix info.
    const header = screen.getByTestId("node-header")
    expect(within(header).getByText("http-request")).toBeInTheDocument()
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
    const data = makeData(
      "request",
      { uses: "@core/http-request" },
      { inputs: emptyInputRoot, outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("core")).toBeInTheDocument()
  })

  it("shows 'node' kind label for ./ nodes", () => {
    const data = makeData("save", { uses: "./nodes/save" }, { inputs: emptyInputRoot, outputs: [] })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("node")).toBeInTheDocument()
  })

  it("shows 'external' kind label for other uses", () => {
    const data = makeData(
      "ext",
      { uses: "some-package/node" },
      { inputs: emptyInputRoot, outputs: [] },
    )
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("external")).toBeInTheDocument()
  })

  it("renders uses path in footer", () => {
    const data = makeData(
      "save",
      { uses: "./nodes/users/save-user" },
      { inputs: emptyInputRoot, outputs: [] },
    )
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
    // The synthetic root handle is rendered as "$root" (ROOT_HANDLE_ID) so
    // React Flow can form connections to it (empty-string ids are rejected).
    expect(screen.getByTestId("handle-target-$root")).toBeInTheDocument()
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
    const data = makeData("request", { uses: "@core/http-request" }, ports, {
      schemaName: "HTTP Request",
    })
    render(<WorkflowNode data={data} />)
    expect(screen.getByText("HTTP Request")).toBeInTheDocument()
    expect(screen.queryByTestId(/^handle-target/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^handle-source/)).not.toBeInTheDocument()
  })

  it("uses graceful fallback when ports is undefined", () => {
    const data: Record<string, unknown> = {
      id: "legacy",
      instance: { uses: "@core/http-request" },
    }
    render(<WorkflowNode data={data} />)
    // No schemaName and no instance.label — falls back to the `uses`-derived name.
    expect(screen.getByText("http-request")).toBeInTheDocument()
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
      // Root branch is "input" with a chevron; the root handle is "$root" (ROOT_HANDLE_ID)
      expect(screen.getByText("input")).toBeInTheDocument()
      expect(screen.getByTestId("chevron-")).toBeInTheDocument()
      expect(screen.getByTestId("handle-target-$root")).toBeInTheDocument()

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

  describe("selected-node border contrast", () => {
    const baseData = () =>
      makeData("myNode", { uses: "./nodes/myNode" }, { inputs: emptyInputRoot, outputs: [] })

    it("does NOT apply ring-primary when node is not the active selection", () => {
      useSelectionStore.getState().setSelected("otherNode")
      render(<WorkflowNode data={baseData()} />)
      const card = screen.getByTestId("node-card")
      expect(card.className).not.toContain("ring-primary")
    })

    it("applies ring-2 ring-primary when node IS the active selection", () => {
      useSelectionStore.getState().setSelected("myNode")
      render(<WorkflowNode data={baseData()} />)
      const card = screen.getByTestId("node-card")
      expect(card.className).toContain("ring-primary")
    })
  })

  describe("node status borders (debugger)", () => {
    const baseData = () =>
      makeData("n1", { uses: "@core/http-request" }, { inputs: emptyInputRoot, outputs: [] })

    it("applies lorien-running class when data.nodeStatus === 'running'", () => {
      const { container } = render(<WorkflowNode data={{ ...baseData(), nodeStatus: "running" }} />)
      expect(container.querySelector(".lorien-running")).toBeTruthy()
    })

    it("applies lorien-paused class when data.nodeStatus === 'paused'", () => {
      const { container } = render(<WorkflowNode data={{ ...baseData(), nodeStatus: "paused" }} />)
      expect(container.querySelector(".lorien-paused")).toBeTruthy()
    })

    it("applies lorien-errored class when data.nodeStatus === 'errored'", () => {
      const { container } = render(<WorkflowNode data={{ ...baseData(), nodeStatus: "errored" }} />)
      expect(container.querySelector(".lorien-errored")).toBeTruthy()
    })

    it("no status class when data.nodeStatus is undefined", () => {
      const { container } = render(<WorkflowNode data={baseData()} />)
      expect(container.querySelector(".lorien-running")).toBeFalsy()
      expect(container.querySelector(".lorien-paused")).toBeFalsy()
    })
  })

  describe("accent card wash", () => {
    it("washes the card and header with a faint accent when color is set", () => {
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save" },
        ports: { inputs: emptyInputRoot, outputs: [] },
        color: "#a78bfa",
      }
      render(<WorkflowNode data={data} />)
      const card = screen.getByTestId("node-card")
      const header = screen.getByTestId("node-header")
      // color-mix() values are passed through verbatim by jsdom.
      const cardStyle = card.getAttribute("style") ?? ""
      const headerStyle = header.getAttribute("style") ?? ""
      expect(cardStyle).toContain("color-mix")
      expect(cardStyle).toContain("#a78bfa")
      expect(cardStyle).toContain("var(--popover)")
      expect(headerStyle).toContain("color-mix")
      expect(headerStyle).toContain("#a78bfa")
    })

    it("resolves a Tailwind color name to its 500-weight hex in the wash", () => {
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save" },
        ports: { inputs: emptyInputRoot, outputs: [] },
        color: "amber",
      }
      render(<WorkflowNode data={data} />)
      const card = screen.getByTestId("node-card")
      // amber-500 = #f59e0b.
      expect(card.getAttribute("style")).toContain("#f59e0b")
    })

    it("passes raw hex colors through unchanged (CORE_SCHEMAS path)", () => {
      const data: Record<string, unknown> = {
        id: "request",
        instance: { uses: "@core/http-request" },
        ports: { inputs: emptyInputRoot, outputs: [] },
        color: "#3b82f6",
      }
      render(<WorkflowNode data={data} />)
      const card = screen.getByTestId("node-card")
      expect(card.getAttribute("style")).toContain("#3b82f6")
    })

    it("tints only the header, by kind, when color is missing", () => {
      const data: Record<string, unknown> = {
        id: "save",
        instance: { uses: "./save" },
        ports: { inputs: emptyInputRoot, outputs: [] },
      }
      render(<WorkflowNode data={data} />)
      const card = screen.getByTestId("node-card")
      const header = screen.getByTestId("node-header")
      expect(card.getAttribute("style") ?? "").not.toContain("color-mix")
      // A ./ node takes the "node" kind colour.
      expect(header.getAttribute("style")).toContain("var(--ai)")
    })
  })

  describe("breakpoint dots", () => {
    const baseData = () =>
      makeData("n1", { uses: "@core/http-request" }, { inputs: emptyInputRoot, outputs: [] })

    it("renders a left-side dot when nodeBreakpoint.before is true", () => {
      const { container } = render(
        <WorkflowNode data={{ ...baseData(), nodeBreakpoint: { before: true, after: false } }} />,
      )
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeFalsy()
    })

    it("renders a right-side dot when nodeBreakpoint.after is true", () => {
      const { container } = render(
        <WorkflowNode data={{ ...baseData(), nodeBreakpoint: { before: false, after: true } }} />,
      )
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeFalsy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeTruthy()
    })

    it("renders both dots when both kinds are set", () => {
      const { container } = render(
        <WorkflowNode data={{ ...baseData(), nodeBreakpoint: { before: true, after: true } }} />,
      )
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeTruthy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeTruthy()
    })

    it("does NOT render any breakpoint dot when nodeBreakpoint is absent", () => {
      const { container } = render(<WorkflowNode data={baseData()} />)
      expect(container.querySelector('[data-testid="node-breakpoint-dot-before"]')).toBeFalsy()
      expect(container.querySelector('[data-testid="node-breakpoint-dot-after"]')).toBeFalsy()
    })

    it("renders a port breakpoint dot at the matching output port", () => {
      const data = {
        ...baseData(),
        ports: {
          inputs: emptyInputRoot,
          outputs: [{ id: "foo", label: "foo", children: [], isLeaf: true }],
        },
        portBreakpoints: new Set(["foo"]),
      }
      const { container } = render(<WorkflowNode data={data} />)
      expect(container.querySelector('[data-testid="port-breakpoint-foo"]')).toBeTruthy()
    })

    it("does NOT render a port dot for a port not in portBreakpoints", () => {
      const data = {
        ...baseData(),
        ports: {
          inputs: emptyInputRoot,
          outputs: [{ id: "bar", label: "bar", children: [], isLeaf: true }],
        },
        portBreakpoints: new Set<string>(),
      }
      const { container } = render(<WorkflowNode data={data} />)
      expect(container.querySelector('[data-testid="port-breakpoint-bar"]')).toBeFalsy()
    })
  })

  describe("value chips", () => {
    /** Helper: leaf port with an attached schema */
    const schemaLeaf = (
      name: string,
      schema: NonNullable<PortNode["schema"]>,
      required = false,
    ): PortNode => {
      const port: PortNode = { id: name, label: name, children: [], isLeaf: true }
      port.schema = schema
      if (required) port.required = true
      return port
    }
    const render1 = (
      port: PortNode,
      instance: NodeInstance,
      extra: Record<string, unknown> = {},
    ): Array<{ portId: string; value: unknown }> => {
      const calls: Array<{ portId: string; value: unknown }> = []
      render(
        <WorkflowNode
          data={{
            id: "n",
            instance,
            ports: { inputs: inputRoot([port]), outputs: [] },
            expandedInputs: new Set([""]),
            expandedOutputs: new Set<string>(),
            onTogglePort: () => {},
            onInputValueChange: (portId: string, value: unknown) => calls.push({ portId, value }),
            ...extra,
          }}
        />,
      )
      return calls
    }

    it("shows the value on the same row as the label", () => {
      render1(schemaLeaf("maxPct", { type: "number" }), { uses: "./n", values: { maxPct: 50 } })
      const chip = screen.getByTestId("input-chip-maxPct")
      expect(chip.textContent).toBe("50")
      expect(chip.parentElement).toBe(screen.getByText("maxPct").parentElement)
    })

    it("shows a connected input's source instead of an editor", () => {
      render1(schemaLeaf("cart", { type: "string" }), {
        uses: "./n",
        in: { cart: "loadCart.cart" },
      })
      expect(screen.getByText("← loadCart.cart")).toBeInTheDocument()
      expect(screen.queryByTestId("input-chip-cart")).not.toBeInTheDocument()
    })

    it("marks a missing required input", () => {
      render1(schemaLeaf("code", { type: "string" }, true), { uses: "./n" })
      expect(screen.getByTestId("input-chip-code").textContent).toBe("required")
    })

    it("shows the template-expanded schema default when nothing is set", () => {
      render1(
        schemaLeaf("path", { type: "string", default: "{workflow_path}" }),
        { uses: "@core/http-request" },
        { workflowPath: "workflows/users/create.workflow" },
      )
      const chip = screen.getByTestId("input-chip-path")
      expect(chip.textContent).toBe("/users")
      expect(chip.className).toContain("border-dashed")
    })

    it("values: takes precedence over schema.default", () => {
      render1(schemaLeaf("path", { type: "string", default: "/x" }), {
        uses: "./n",
        values: { path: "/custom" },
      })
      expect(screen.getByTestId("input-chip-path").textContent).toBe("/custom")
    })

    it("edits text in place and commits once on Enter", () => {
      const calls = render1(schemaLeaf("path", { type: "string" }), { uses: "./n" })
      fireEvent.click(screen.getByTestId("input-chip-path"))
      const input = screen.getByTestId("input-widget-path")
      expect(input.getAttribute("type")).toBe("text")
      fireEvent.change(input, { target: { value: "/a" } })
      fireEvent.change(input, { target: { value: "/api/users" } })
      expect(calls).toHaveLength(0)
      fireEvent.keyDown(input, { key: "Enter" })
      expect(calls).toEqual([{ portId: "path", value: "/api/users" }])
    })

    it("commits numbers as numbers", () => {
      const calls = render1(schemaLeaf("count", { type: "integer" }), { uses: "./n" })
      fireEvent.click(screen.getByTestId("input-chip-count"))
      const input = screen.getByTestId("input-widget-count")
      expect(input.getAttribute("type")).toBe("number")
      fireEvent.change(input, { target: { value: "7" } })
      fireEvent.blur(input)
      expect(calls).toEqual([{ portId: "count", value: 7 }])
    })

    it("Escape cancels an edit", () => {
      const calls = render1(schemaLeaf("path", { type: "string" }), { uses: "./n" })
      fireEvent.click(screen.getByTestId("input-chip-path"))
      const input = screen.getByTestId("input-widget-path")
      fireEvent.change(input, { target: { value: "/nope" } })
      fireEvent.keyDown(input, { key: "Escape" })
      expect(calls).toHaveLength(0)
      expect(screen.getByTestId("input-chip-path")).toBeInTheDocument()
    })

    it("clearing a value resets it to the default", () => {
      const calls = render1(schemaLeaf("path", { type: "string", default: "/" }), {
        uses: "./n",
        values: { path: "/custom" },
      })
      fireEvent.click(screen.getByTestId("input-chip-path"))
      const input = screen.getByTestId("input-widget-path")
      fireEvent.change(input, { target: { value: "" } })
      fireEvent.keyDown(input, { key: "Enter" })
      expect(calls).toEqual([{ portId: "path", value: undefined }])
    })

    it("picks an enum value from a picker", () => {
      const calls = render1(
        schemaLeaf("method", { type: "string", enum: ["GET", "POST", "DELETE"], default: "GET" }),
        { uses: "@core/http-request", values: { method: "POST" } },
      )
      fireEvent.click(screen.getByTestId("input-chip-method"))
      expect(screen.getByRole("option", { name: "POST" }).getAttribute("aria-selected")).toBe(
        "true",
      )
      fireEvent.click(screen.getByRole("option", { name: "DELETE" }))
      expect(calls).toEqual([{ portId: "method", value: "DELETE" }])
    })

    it("offers Reset to default in the enum picker", () => {
      const calls = render1(
        schemaLeaf("method", { type: "string", enum: ["GET", "POST"], default: "GET" }),
        { uses: "@core/http-request", values: { method: "POST" } },
      )
      fireEvent.click(screen.getByTestId("input-chip-method"))
      fireEvent.click(screen.getByRole("button", { name: "Reset to default" }))
      expect(calls).toEqual([{ portId: "method", value: undefined }])
    })

    it("toggles booleans with a switch", () => {
      const calls = render1(schemaLeaf("stack", { type: "boolean" }), {
        uses: "./n",
        values: { stack: true },
      })
      const sw = screen.getByRole("switch", { name: "stack" })
      expect(sw.getAttribute("aria-checked")).toBe("true")
      fireEvent.click(sw)
      expect(calls).toEqual([{ portId: "stack", value: false }])
    })

    it("shows an object input as a field count that expands the row", () => {
      render(
        <WorkflowNode
          data={makeData(
            "n",
            { uses: "./n" },
            {
              inputs: inputRoot([
                branch("user", [leaf("id", "user.id"), leaf("name", "user.name")]),
              ]),
              outputs: [],
            },
            { expandedInputs: new Set([""]), expandedOutputs: new Set(), onTogglePort: () => {} },
          )}
        />,
      )
      expect(screen.getByTestId("chevron-user").textContent).toContain("2 fields")
    })
  })

  describe("validation issues", () => {
    const base = () => ({ inputs: emptyInputRoot, outputs: [] })

    it("shows no badge when the node has no issues", () => {
      render(<WorkflowNode data={makeData("a", { uses: "./nodes/a" }, base())} />)
      expect(screen.queryByTestId("node-issue-badge")).toBeNull()
    })

    it("shows an error badge with the count and messages, and a red border", () => {
      const issues = [
        { key: "1", severity: "error", nodeId: "a", message: "Missing required input email" },
        { key: "2", severity: "warning", nodeId: "a", message: "user.id is not an output" },
      ]
      render(<WorkflowNode data={makeData("a", { uses: "./nodes/a" }, base(), { issues })} />)
      const badge = screen.getByTestId("node-issue-badge")
      expect(badge.textContent).toBe("2")
      expect(badge.getAttribute("aria-label")).toContain("Missing required input email")
      expect(badge.getAttribute("title")).toContain("user.id is not an output")
      expect(screen.getByTestId("node-card").className).toContain("border-destructive")
    })

    it("uses the warning style when the node only has warnings", () => {
      const issues = [{ key: "1", severity: "warning", nodeId: "a", message: "Unused" }]
      render(<WorkflowNode data={makeData("a", { uses: "./nodes/a" }, base(), { issues })} />)
      expect(screen.getByTestId("node-issue-badge").getAttribute("aria-label")).toBe(
        "1 problem: Unused",
      )
      expect(screen.getByTestId("node-card").className).toContain("border-warning")
    })
  })

  describe("test results", () => {
    const base = () => ({ inputs: emptyInputRoot, outputs: [] })

    it("shows a passing badge once cases have run", () => {
      render(
        <WorkflowNode
          data={makeData("a", { uses: "./nodes/a" }, base(), {
            tests: { total: 3, run: 3, passed: 3, failed: 0 },
          })}
        />,
      )
      const badge = screen.getByTestId("node-tests-badge")
      expect(badge.getAttribute("aria-label")).toBe("Tests: 3 of 3 passing")
      expect(badge.textContent).toBe("3")
    })

    it("shows failures as failed/run", () => {
      render(
        <WorkflowNode
          data={makeData("a", { uses: "./nodes/a" }, base(), {
            tests: { total: 3, run: 2, passed: 1, failed: 1 },
          })}
        />,
      )
      expect(screen.getByTestId("node-tests-badge").textContent).toBe("1/2")
      expect(screen.getByRole("img", { name: "Tests: 1 of 2 failing" })).toBeInTheDocument()
    })

    it("shows nothing when there are no results", () => {
      render(<WorkflowNode data={makeData("a", { uses: "./nodes/a" }, base(), { tests: null })} />)
      expect(screen.queryByTestId("node-tests-badge")).toBeNull()
    })
  })
})

describe("WorkflowNode — providers", () => {
  afterEach(() => resetProvidersStore())

  it("shows a chip for each provider the node reads, which opens its file", () => {
    useProvidersStore.setState({
      providers: [
        {
          name: "db",
          path: "providers/db.ts",
          lifetime: "singleton",
          uses: [],
          env: [],
          hasDispose: false,
          packages: [],
          usedBy: ["nodes/pets/add-pet.ts"],
        },
      ],
      nodes: { "./nodes/pets/add-pet": ["db"] },
      loaded: true,
    })
    render(
      <WorkflowNode
        data={makeData(
          "add-pet",
          { uses: "./nodes/pets/add-pet" },
          { inputs: emptyInputRoot, outputs: [] },
        )}
      />,
    )
    const footer = screen.getByTestId("node-footer")
    fireEvent.click(within(footer).getByRole("button", { name: "db" }))
    expect(useTabsStore.getState().activeCodeId).toBe("providers/db.ts")
  })
})
