import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export interface PathEdgeData {
  /** Dotted path label for hover (e.g. "body.email"). Optional. */
  pathLabel?: string
}

/**
 * Custom React Flow edge that draws a small dot at the midpoint of the bezier.
 * Hovering the dot reveals the deeper-path info (e.g. ".email") in a tooltip.
 *
 * For edges where the source-side path is trivial (whole-object connections or
 * single-segment references), `pathLabel` may be omitted — the dot disappears
 * and the edge renders as plain.
 */
export function PathEdge(props: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  const pathLabel = (props.data as PathEdgeData | undefined)?.pathLabel
  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        {...(props.markerEnd !== undefined ? { markerEnd: props.markerEnd } : {})}
        {...(props.style !== undefined ? { style: props.style } : {})}
      />
      {pathLabel && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-auto absolute"
            data-testid={`path-edge-label-${props.id}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="Path info"
                    className="h-2.5 w-2.5 rounded-full border border-border bg-card shadow-sm hover:bg-accent"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <code className="font-mono text-xs">{pathLabel}</code>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
