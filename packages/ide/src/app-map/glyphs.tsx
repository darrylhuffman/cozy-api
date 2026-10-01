import { cn } from "@/lib/utils"
import { methodTone } from "@/panels/run-tab/method-tone"
import type { MapKind } from "./model"

/** The small shape each kind is drawn as on the map, for lists and the legend. */
export function KindGlyph({
  kind,
  color,
  method,
}: {
  kind: MapKind
  color: string
  method: string | null
}) {
  if (kind === "workflow") {
    return (
      <svg
        width={14}
        height={10}
        aria-hidden="true"
        className={cn("shrink-0", method ? methodTone(method) : "text-muted-foreground")}
      >
        <rect
          x={0.75}
          y={0.75}
          width={12.5}
          height={8.5}
          rx={3}
          fill="currentColor"
          fillOpacity={0.18}
          stroke="currentColor"
        />
      </svg>
    )
  }
  const shape =
    kind === "node" ? (
      <circle cx={6} cy={6} r={4.75} />
    ) : kind === "middleware" ? (
      <path d="M6 1 11 6 6 11 1 6Z" />
    ) : (
      <path d="M11 6 8.5 10.3H3.5L1 6 3.5 1.7H8.5Z" />
    )
  return (
    <svg width={12} height={12} aria-hidden="true" className="shrink-0">
      <g fill={color} fillOpacity={0.22} stroke={color} strokeWidth={1.4}>
        {shape}
      </g>
    </svg>
  )
}
