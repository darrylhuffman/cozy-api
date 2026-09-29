import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

/** A single source→target binding represented by one row in the hover table. */
export interface PathMapping {
  /** Fully-qualified source path, e.g. "request.body.email" */
  source: string
  /** Fully-qualified target path, e.g. "save.email" or "save" for whole-object */
  target: string
}

export interface PathEdgeData {
  /**
   * The list of underlying reference bindings represented by this edge.
   * When N per-field edges collapse onto the same visual (source, target,
   * handles) tuple, all of their mappings end up in this array so the user
   * can hover the dot and see every path flowing through.
   */
  mappings: PathMapping[]
}

/**
 * Custom React Flow edge that draws a small dot at the midpoint of the bezier.
 * Hovering the dot opens a HoverCard with a table of every underlying mapping
 * — one row per (source, target) pair, columns for the source path, an arrow,
 * and the target path.
 *
 * The dot is suppressed when there are no mappings — the edge then renders as
 * a plain bezier without any interactive overlay.
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
  const mappings = (props.data as PathEdgeData | undefined)?.mappings ?? []
  const showDot = mappings.length > 0
  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        {...(props.markerEnd !== undefined ? { markerEnd: props.markerEnd } : {})}
        {...(props.style !== undefined ? { style: props.style } : {})}
      />
      {showDot && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-auto absolute"
            data-testid={`path-edge-label-${props.id}`}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <HoverCard openDelay={150} closeDelay={100}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  aria-label="Path info"
                  className="h-2.5 w-2.5 rounded-full border border-border bg-card shadow-sm hover:bg-accent"
                />
              </HoverCardTrigger>
              <HoverCardContent
                className="w-auto p-0 overflow-hidden"
                align="center"
                side="top"
              >
                <table className="font-mono text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                        Source
                      </th>
                      <th className="px-1 py-1.5" aria-hidden />
                      <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">
                        Target
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m, idx) => (
                      <tr
                        key={`${m.source}->${m.target}`}
                        className={idx > 0 ? "border-t border-border/50" : undefined}
                      >
                        <td className="px-3 py-1 whitespace-nowrap">{m.source}</td>
                        <td className="px-1 py-1 text-muted-foreground" aria-hidden>
                          →
                        </td>
                        <td className="px-3 py-1 whitespace-nowrap">{m.target}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </HoverCardContent>
            </HoverCard>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
