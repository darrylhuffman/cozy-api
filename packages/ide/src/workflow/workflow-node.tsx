import { Handle, Position } from "@xyflow/react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"
import type { NodeInstance } from "@/lib/api"
import type { NodePorts, PortNode } from "./derive-ports"

export interface WorkflowNodeData {
  id: string
  instance: NodeInstance
  ports: NodePorts
  /** Accent color (CSS color string). When set, renders a left stripe. */
  color?: string | null
  /** Set of EXPANDED parent paths for the inputs tree. Optional — defaults to
   *  the natural "everything collapsed" state.  The editor passes this in to
   *  lift expansion state out of the node and into a single source of truth. */
  expandedInputs?: ReadonlySet<string>
  /** Set of EXPANDED parent paths for the outputs tree. */
  expandedOutputs?: ReadonlySet<string>
  /** Toggle callback. When provided, the node delegates toggle clicks to the
   *  editor; otherwise it falls back to local useState (for unit tests). */
  onTogglePort?: (side: "input" | "output", handleId: string) => void
}

// Using the xyflow NodeProps generic requires the data type to extend Node which
// carries position/measured etc. Instead we accept the full props object and
// extract `data` ourselves — this keeps our interface clean.
interface WorkflowNodeProps {
  data: Record<string, unknown>
}

const ROW_HEIGHT = 22
const INDENT_PX = 12
/** When a branch has more than this many children, show a "+N more" button. */
const VISIBLE_COUNT = 6

const EMPTY_ROOT_INPUT: PortNode = { id: "", label: "input", children: [], isLeaf: true }

export function WorkflowNode({ data }: WorkflowNodeProps) {
  const {
    id,
    instance,
    ports,
    color,
    expandedInputs,
    expandedOutputs,
    onTogglePort,
  } = data as unknown as WorkflowNodeData
  const isCore = instance.uses.startsWith("@core/")
  const isLocal = instance.uses.startsWith("./")
  const kindLabel = isCore ? "core" : isLocal ? "node" : "external"
  const displayName = instance.label ?? id
  const safePorts: NodePorts = ports ?? { inputs: EMPTY_ROOT_INPUT, outputs: [] }

  // Triggers (and other nodes that take no input) shouldn't show the synthetic
  // root branch — it would be a dead-end leaf with no handle. We detect this
  // by an empty leaf root.
  const showInputRoot = !(
    safePorts.inputs.id === "" &&
    safePorts.inputs.isLeaf &&
    safePorts.inputs.children.length === 0
  )

  return (
    <div
      className="rounded-md border border-border bg-card text-card-foreground shadow-sm"
      style={{ width: 240, position: "relative" }}
    >
      {/* Accent stripe — pure decoration; only when a color is set. */}
      {color ? (
        <div
          data-testid="accent-stripe"
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 3,
            bottom: 0,
            background: color,
            borderTopLeftRadius: 6,
            borderBottomLeftRadius: 6,
          }}
        />
      ) : null}

      {/* Header */}
      <div className="border-b border-border bg-muted px-3 py-1.5 text-xs">
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {kindLabel}
        </div>
        <div className="truncate font-medium">{displayName}</div>
      </div>

      {/* Body — port trees side by side */}
      <div className="flex">
        <div className="flex-1 border-r border-border py-1">
          {showInputRoot && (
            <PortRow
              port={safePorts.inputs}
              depth={0}
              side="input"
              expandedSet={expandedInputs}
              onToggle={onTogglePort}
            />
          )}
        </div>
        <div className="flex-1 py-1">
          <PortTree
            ports={safePorts.outputs}
            side="output"
            expandedSet={expandedOutputs}
            onToggle={onTogglePort}
          />
        </div>
      </div>

      {/* Footer — uses */}
      <div className="truncate border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
        {instance.uses}
      </div>
    </div>
  )
}

function PortTree({
  ports,
  side,
  expandedSet,
  onToggle,
}: {
  ports: PortNode[]
  side: "input" | "output"
  expandedSet: ReadonlySet<string> | undefined
  onToggle: ((side: "input" | "output", handleId: string) => void) | undefined
}) {
  return (
    <div>
      {ports.map((port) => (
        <PortRow
          key={port.id}
          port={port}
          depth={0}
          side={side}
          expandedSet={expandedSet}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}

function PortRow({
  port,
  depth,
  side,
  expandedSet,
  onToggle,
}: {
  port: PortNode
  depth: number
  side: "input" | "output"
  expandedSet: ReadonlySet<string> | undefined
  onToggle: ((side: "input" | "output", handleId: string) => void) | undefined
}) {
  // When the editor provides controlled state, defer to it. Otherwise fall
  // back to local state (preserved for test-only usage of WorkflowNode).
  const controlled = expandedSet !== undefined
  const isExpandedControlled = controlled && expandedSet?.has(port.id) === true
  const [localExpanded, setLocalExpanded] = useState(false)
  const expanded = controlled ? isExpandedControlled : localExpanded

  // "Show more" override — applies once the user clicks to reveal hidden
  // children of a long branch. Always per-instance (no need to lift).
  const [showAllChildren, setShowAllChildren] = useState(false)

  const isBranch = port.children.length > 0
  const isOutput = side === "output"
  const handleType = isOutput ? "source" : "target"
  const handlePosition = isOutput ? Position.Right : Position.Left

  const toggle = () => {
    if (controlled && onToggle) {
      onToggle(side, port.id)
    } else {
      setLocalExpanded((v) => !v)
    }
  }

  const chevron = isBranch ? (
    <button
      type="button"
      aria-label={expanded ? `Collapse ${port.label}` : `Expand ${port.label}`}
      data-testid={`chevron-${port.id}`}
      onClick={(e) => {
        e.stopPropagation()
        toggle()
      }}
      className="inline-flex h-3 w-3 items-center justify-center text-muted-foreground hover:text-foreground"
    >
      {expanded ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronRight className="h-3 w-3" />
      )}
    </button>
  ) : null

  const label = (
    <span
      className={
        isBranch
          ? "truncate text-xs font-medium text-foreground"
          : "truncate text-xs text-muted-foreground"
      }
    >
      {port.label}
    </span>
  )

  const visibleChildren = showAllChildren
    ? port.children
    : port.children.slice(0, VISIBLE_COUNT)
  const hiddenCount = port.children.length - visibleChildren.length

  return (
    <>
      <div
        className="relative flex items-center gap-1"
        style={{
          height: ROW_HEIGHT,
          paddingLeft: isOutput ? 8 : 8 + depth * INDENT_PX,
          paddingRight: isOutput ? 8 + depth * INDENT_PX : 8,
          justifyContent: isOutput ? "flex-end" : "flex-start",
        }}
      >
        <Handle
          type={handleType}
          position={handlePosition}
          id={port.id}
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            background: isBranch
              ? "var(--primary, oklch(0.6 0.2 270))"
              : "var(--muted-foreground)",
          }}
        />
        {isOutput ? (
          <>
            {label}
            {chevron}
          </>
        ) : (
          <>
            {chevron}
            {label}
          </>
        )}
      </div>
      {expanded && (
        <>
          {visibleChildren.map((child) => (
            <PortRow
              key={child.id}
              port={child}
              depth={depth + 1}
              side={side}
              expandedSet={expandedSet}
              onToggle={onToggle}
            />
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              data-testid={`show-more-${port.id}`}
              onClick={(e) => {
                e.stopPropagation()
                setShowAllChildren(true)
              }}
              className="ml-6 text-[11px] text-muted-foreground hover:text-foreground"
              style={{
                paddingLeft: isOutput ? 0 : 8 + (depth + 1) * INDENT_PX,
                paddingRight: isOutput ? 8 + (depth + 1) * INDENT_PX : 0,
                width: "100%",
                textAlign: isOutput ? "right" : "left",
                height: ROW_HEIGHT,
              }}
            >
              +{hiddenCount} more
            </button>
          )}
        </>
      )}
    </>
  )
}
