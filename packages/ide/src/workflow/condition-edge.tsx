import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react"
import { ArrowLeftRight, GitBranch } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

export interface ConditionEdgeData {
  /** The full `when` string, e.g. "!FindRoom.found". */
  when: string
  /** Short label, e.g. "if not found". */
  label: string
  negate: boolean
  /** Flips the condition between truthy and falsy. */
  onFlip?: () => void
}

/** Edges spanning less than this (px) show only the branch icon until hovered. */
const COMPACT_BELOW = 180

/** Branch colours: the truthy side and the falsy side of the same output. */
export function conditionColor(negate: boolean): string {
  return negate ? "var(--warning)" : "var(--success)"
}

/**
 * A `when` condition drawn as a dashed edge into the node it gates, with a
 * pill at the midpoint naming the branch ("if found" / "if not found"). The
 * pill's swap button flips the condition.
 */
export function ConditionEdge(props: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  const data = props.data as ConditionEdgeData | undefined
  const color = conditionColor(data?.negate ?? false)
  const [hovered, setHovered] = useState(false)
  // Between neighbouring columns there's no room for the full pill without
  // covering the cards (whose condition row already names the branch), so
  // it shrinks to its icon and opens on hover.
  const compact = Math.abs(props.targetX - props.sourceX) < COMPACT_BELOW && !hovered
  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        style={{
          stroke: props.selected ? "var(--primary)" : color,
          strokeWidth: 1.5,
          strokeDasharray: "6 4",
          ...props.style,
        }}
      />
      {data && (
        <EdgeLabelRenderer>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: hover only widens the label; the flip button is the control */}
          <div
            data-testid={`condition-edge-label-${props.id}`}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={cn(
              "nodrag nopan pointer-events-auto absolute flex items-center rounded-full border bg-popover font-mono text-[10.5px] shadow-sm",
              compact ? "h-[18px] w-[18px] justify-center" : "h-[22px] gap-1 pr-0.5 pl-2",
              props.selected && "ring-1 ring-primary",
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              // An opened pill may overlap a card; keep it on top while hovered.
              zIndex: hovered ? 1001 : undefined,
              borderColor: `color-mix(in srgb, ${color} 55%, transparent)`,
              color,
            }}
            title={`Runs when ${data.when}`}
          >
            <GitBranch aria-hidden className="h-3 w-3 shrink-0" />
            {!compact && <span className="whitespace-nowrap text-foreground">{data.label}</span>}
            {!compact && data.onFlip && (
              <button
                type="button"
                aria-label="Flip condition"
                title="Flip condition"
                onClick={(e) => {
                  e.stopPropagation()
                  data.onFlip?.()
                }}
                className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ArrowLeftRight aria-hidden className="h-3 w-3" />
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
