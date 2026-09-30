import { type ConnectionLineComponentProps, getBezierPath } from "@xyflow/react"
import { useSchemasStore } from "@/store/schemas"
import { describeVariable, schemaAtPath, VARIABLE_USES } from "./variables"
import { ROOT_HANDLE_ID, type WorkflowNodeData } from "./workflow-node"

/**
 * The line drawn while a connection is dragged. Pulled from an input and held
 * over empty canvas, it previews the variable that letting go will create.
 */
export function ConnectionLine(p: ConnectionLineComponentProps) {
  const [d] = getBezierPath({
    sourceX: p.fromX,
    sourceY: p.fromY,
    sourcePosition: p.fromPosition,
    targetX: p.toX,
    targetY: p.toY,
    targetPosition: p.toPosition,
  })
  const schemas = useSchemasStore((s) => s.schemas)
  const data = p.fromNode.data as Partial<WorkflowNodeData>
  const uses = data.instance?.uses
  const pullingInput =
    p.fromHandle.type === "target" &&
    p.toNode === null &&
    uses !== undefined &&
    uses !== VARIABLE_USES
  const portId = p.fromHandle.id === ROOT_HANDLE_ID ? "" : (p.fromHandle.id ?? "")
  const label = portId === "" ? "input" : (portId.split(".").pop() ?? portId)

  return (
    <g>
      <path
        d={d}
        fill="none"
        className="react-flow__connection-path"
        style={pullingInput ? { stroke: "var(--info)", strokeWidth: 1.6 } : p.connectionLineStyle}
      />
      {pullingInput && (
        <foreignObject
          x={p.toX - 200}
          y={p.toY - 14}
          width={192}
          height={28}
          style={{ overflow: "visible" }}
        >
          <div
            data-testid="variable-ghost"
            className="ml-auto flex h-7 w-fit max-w-[192px] items-center gap-1.5 rounded-[7px] border border-info/60 bg-popover px-2 text-[11px] shadow-md"
          >
            <span className="truncate font-mono font-semibold">{label}</span>
            <span className="shrink-0 text-muted-foreground">
              {describeVariable(schemaAtPath(schemas[uses]?.inputs, portId))}
            </span>
          </div>
        </foreignObject>
      )}
    </g>
  )
}
