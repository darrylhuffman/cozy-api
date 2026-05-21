import { Handle, Position } from "@xyflow/react"
import type { NodeInstance } from "@/lib/api"
import type { NodePorts } from "./derive-ports"

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

const PORT_ROW_HEIGHT = 22

export function WorkflowNode({ data }: WorkflowNodeProps) {
  const { id, instance, ports } = data as unknown as WorkflowNodeData
  const isCore = instance.uses.startsWith("@core/")
  const isLocal = instance.uses.startsWith("./")
  const kindLabel = isCore ? "core" : isLocal ? "node" : "external"
  const displayName = instance.label ?? id

  // Guarantee ports is always defined (graceful fallback when data is partial)
  const safePorts: NodePorts = ports ?? { inputs: [], outputs: [] }
  const maxRows = Math.max(safePorts.inputs.length, safePorts.outputs.length, 1)
  const bodyHeight = maxRows * PORT_ROW_HEIGHT + 12

  return (
    <div
      className="rounded-md border border-border bg-card text-card-foreground shadow-sm"
      style={{ width: 200 }}
    >
      {/* Header */}
      <div className="border-b border-border bg-muted px-3 py-1.5 text-xs">
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {kindLabel}
        </div>
        <div className="truncate font-medium">{displayName}</div>
      </div>

      {/* Body — port rows */}
      <div className="relative" style={{ height: bodyHeight }}>
        {/* Left column: input ports */}
        <div className="absolute left-0 top-0 flex w-1/2 flex-col pt-[6px]">
          {safePorts.inputs.map((port) => (
            <div
              key={port.id}
              className="relative flex items-center"
              style={{ height: PORT_ROW_HEIGHT }}
            >
              <Handle
                type="target"
                position={Position.Left}
                id={port.id}
                style={{
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "var(--muted-foreground)",
                }}
              />
              <span className="truncate pl-3 text-xs text-muted-foreground">{port.label}</span>
            </div>
          ))}
        </div>

        {/* Right column: output ports */}
        <div className="absolute right-0 top-0 flex w-1/2 flex-col items-end pt-[6px]">
          {safePorts.outputs.map((port) => (
            <div
              key={port.id}
              className="relative flex items-center justify-end"
              style={{ height: PORT_ROW_HEIGHT }}
            >
              <span className="truncate pr-3 text-xs text-muted-foreground">{port.label}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={port.id}
                style={{
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "var(--muted-foreground)",
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Footer — uses */}
      <div className="truncate border-t border-border px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
        {instance.uses}
      </div>
    </div>
  )
}
