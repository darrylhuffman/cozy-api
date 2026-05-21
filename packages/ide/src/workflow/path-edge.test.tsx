import { cleanup, render, screen } from "@testing-library/react"
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

// Mock the shadcn tooltip — RadixUI's TooltipContent uses Portal which doesn't
// always render in jsdom. We just pass children through so we can assert.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}))

import { PathEdge } from "./path-edge.js"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// Helper: minimal EdgeProps-compatible object. PathEdge only reads a subset.
const makeProps = (id: string, data?: { pathLabel?: string }) =>
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

  it("renders the hover dot when data.pathLabel is set", () => {
    render(
      <svg>
        <PathEdge {...makeProps("e2", { pathLabel: "body.email" })} />
      </svg>,
    )
    // The dot is a button labelled "Path info"
    const dot = screen.getByRole("button", { name: /path info/i })
    expect(dot).toBeInTheDocument()
    // The tooltip content is wired with the path label
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent("body.email")
  })

  it("omits the hover dot when pathLabel is undefined (trivial edge)", () => {
    render(
      <svg>
        <PathEdge {...makeProps("e3")} />
      </svg>,
    )
    expect(screen.queryByRole("button", { name: /path info/i })).not.toBeInTheDocument()
  })

  it("dot uses path-edge-label-<id> data-testid for stable selection", () => {
    render(
      <svg>
        <PathEdge {...makeProps("e4", { pathLabel: "x.y" })} />
      </svg>,
    )
    expect(screen.getByTestId("path-edge-label-e4")).toBeInTheDocument()
  })
})
