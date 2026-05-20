import { Handle, Position } from "@xyflow/react"
import type { NodeInstance } from "@/lib/api"

export interface WorkflowNodeData {
  id: string
  instance: NodeInstance
}

// Using the xyflow NodeProps generic requires the data type to extend Node which
// carries position/measured etc. Instead we accept the full props object and
// extract `data` ourselves — this keeps our interface clean.
interface WorkflowNodeProps {
  data: Record<string, unknown>
}

export function WorkflowNode({ data }: WorkflowNodeProps) {
  const { id, instance } = data as unknown as WorkflowNodeData
  const isCore = instance.uses.startsWith("@core/")
  const isLocal = instance.uses.startsWith("./")
  const kindLabel = isCore ? "core" : isLocal ? "node" : "external"
  const displayName = instance.label ?? id

  return (
    <div className="min-w-[160px] rounded-md border border-border bg-card text-card-foreground shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-muted-foreground" />
      <div className="border-b border-border bg-muted px-3 py-1.5 text-xs">
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {kindLabel}
        </div>
        <div className="truncate font-medium">{displayName}</div>
      </div>
      <div className="px-3 py-2 text-xs">
        <div className="truncate font-mono text-muted-foreground">{instance.uses}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-muted-foreground" />
    </div>
  )
}
