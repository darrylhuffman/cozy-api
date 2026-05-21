import { Handle, Position } from "@xyflow/react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useState } from "react"
import type { NodeInstance } from "@/lib/api"
import type { NodePorts, PortNode } from "./derive-ports"

export interface WorkflowNodeData {
  id: string
  instance: NodeInstance
  ports: NodePorts
}

// Using the xyflow NodeProps generic requires the data type to extend Node which
// carries position/measured etc. Instead we accept the full props object and
// extract `data` ourselves — this keeps our interface clean.
interface WorkflowNodeProps {
  data: Record<string, unknown>
}

const ROW_HEIGHT = 22
const INDENT_PX = 12

export function WorkflowNode({ data }: WorkflowNodeProps) {
  const { id, instance, ports } = data as unknown as WorkflowNodeData
  const isCore = instance.uses.startsWith("@core/")
  const isLocal = instance.uses.startsWith("./")
  const kindLabel = isCore ? "core" : isLocal ? "node" : "external"
  const displayName = instance.label ?? id
  const safePorts: NodePorts = ports ?? { inputs: [], outputs: [] }

  return (
    <div
      className="rounded-md border border-border bg-card text-card-foreground shadow-sm"
      style={{ width: 240 }}
    >
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
          <PortTree ports={safePorts.inputs} side="input" />
        </div>
        <div className="flex-1 py-1">
          <PortTree ports={safePorts.outputs} side="output" />
        </div>
      </div>

      {/* Footer — uses */}
      <div className="truncate border-t border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">
        {instance.uses}
      </div>
    </div>
  )
}

function PortTree({ ports, side }: { ports: PortNode[]; side: "input" | "output" }) {
  return (
    <div>
      {ports.map((port) => (
        <PortRow key={port.id} port={port} depth={0} side={side} />
      ))}
    </div>
  )
}

function PortRow({
  port,
  depth,
  side,
}: {
  port: PortNode
  depth: number
  side: "input" | "output"
}) {
  const [expanded, setExpanded] = useState(false)
  const isBranch = port.children.length > 0
  const isOutput = side === "output"
  const handleType = isOutput ? "source" : "target"
  const handlePosition = isOutput ? Position.Right : Position.Left

  const chevron = isBranch ? (
    <button
      type="button"
      aria-label={expanded ? `Collapse ${port.label}` : `Expand ${port.label}`}
      data-testid={`chevron-${port.id}`}
      onClick={(e) => {
        e.stopPropagation()
        setExpanded((v) => !v)
      }}
      className="inline-flex h-3 w-3 items-center justify-center text-muted-foreground hover:text-foreground"
    >
      {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
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
            background: isBranch ? "var(--primary, oklch(0.6 0.2 270))" : "var(--muted-foreground)",
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
      {expanded &&
        port.children.map((child) => (
          <PortRow key={child.id} port={child} depth={depth + 1} side={side} />
        ))}
    </>
  )
}
