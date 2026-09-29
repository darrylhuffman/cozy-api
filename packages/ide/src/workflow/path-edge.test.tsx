import { cleanup, render, screen, within } from "@testing-library/react"
import type React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

// Mock @xyflow/react — replace BaseEdge/EdgeLabelRenderer/getBezierPath with
// minimal stubs that let us render the edge in jsdom.
vi.mock("@xyflow/react", () => ({
  BaseEdge: ({ id, path }: { id: string; path: string }) => (
    <path data-testid={`base-edge-${id}`} d={path} />
  ),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  // Returns a tuple matching the real signature: [path, labelX, labelY, ...]
  getBezierPath: (_opts: unknown) => ["M 0 0 L 100 100", 50, 50, 50, 50],
}))

// Mock the shadcn HoverCard — Radix's HoverCardContent uses Portal which doesn't
// reliably render in jsdom AND its open state is gated on a real pointer hover.
// We pass children straight through so the table renders inline and we can
// assert on its structure directly.
vi.mock("@/components/ui/hover-card", () => ({
  HoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="hover-card-content">{children}</div>
  ),
}))

import { PathEdge, type PathMapping } from "./path-edge.js"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Helper: minimal EdgeProps-compatible object. PathEdge only reads a subset.
const makeProps = (id: string, data?: { mappings: PathMapping[] }) =>
  ({
    id,
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 100,
    sourcePosition: "right",
    targetPosition: "left",
    data,
    selected: false,
    animated: false,
  }) as unknown as React.ComponentProps<typeof PathEdge>

describe("PathEdge", () => {
  it("renders the base edge path", () => {
    render(
      <svg>
        <PathEdge {...makeProps("e1")} />
      </svg>,
    )
    expect(screen.getByTestId("base-edge-e1")).toBeInTheDocument()
  })

  it("renders the hover dot when data.mappings has at least one entry", () => {
    render(
      <svg>
        <PathEdge
          {...makeProps("e2", {
            mappings: [{ source: "request.body.email", target: "save.email" }],
          })}
        />
      </svg>,
    )
    const dot = screen.getByRole("button", { name: /path info/i })
    expect(dot).toBeInTheDocument()
  })

  it("omits the hover dot when there are no mappings (trivial edge)", () => {
    render(
      <svg>
        <PathEdge {...makeProps("e3", { mappings: [] })} />
      </svg>,
    )
    expect(screen.queryByRole("button", { name: /path info/i })).not.toBeInTheDocument()
  })

  it("renders a single-row table for one mapping", () => {
    render(
      <svg>
        <PathEdge
          {...makeProps("e4", {
            mappings: [{ source: "request.body", target: "save" }],
          })}
        />
      </svg>,
    )
    const content = screen.getByTestId("hover-card-content")
    // 1 header row + 1 body row
    expect(within(content).getAllByRole("row")).toHaveLength(2)
    expect(within(content).getByText("request.body")).toBeInTheDocument()
    expect(within(content).getByText("save")).toBeInTheDocument()
  })

  it("renders one body row per mapping when N edges merge", () => {
    render(
      <svg>
        <PathEdge
          {...makeProps("e5", {
            mappings: [
              { source: "request.body.email", target: "save.email" },
              { source: "request.body.password", target: "save.password" },
            ],
          })}
        />
      </svg>,
    )
    const content = screen.getByTestId("hover-card-content")
    const rows = within(content).getAllByRole("row")
    // 1 header + 2 body rows
    expect(rows).toHaveLength(3)
    // Each body row carries source + arrow + target as separate cells
    expect(within(content).getByText("request.body.email")).toBeInTheDocument()
    expect(within(content).getByText("save.email")).toBeInTheDocument()
    expect(within(content).getByText("request.body.password")).toBeInTheDocument()
    expect(within(content).getByText("save.password")).toBeInTheDocument()
  })

  it("dot uses path-edge-label-<id> data-testid for stable selection", () => {
    render(
      <svg>
        <PathEdge
          {...makeProps("e6", {
            mappings: [{ source: "x.y", target: "z" }],
          })}
        />
      </svg>,
    )
    expect(screen.getByTestId("path-edge-label-e6")).toBeInTheDocument()
  })
})
