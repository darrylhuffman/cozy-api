import { ArrowLeft } from "lucide-react"
import { openWorkspaceFile } from "@/lib/open-file"
import { useSubworkflowNav } from "@/lib/open-subworkflow"
import { useSchemas } from "@/store/schemas"
import { subworkflowUses } from "./subworkflow"
import { SubworkflowIcon } from "./subworkflow-icon"
import { useSubworkflowUsage } from "./use-subworkflow-usage"

/** Workspace-relative path without its top folder: "workflows/orders/create.workflow" → "orders/create.workflow". */
function shortPath(path: string): string {
  return path.split("/").slice(1).join("/")
}

/**
 * Above a sub-workflow's canvas: a pill back to the workflow it was opened
 * from, and how many workflows a change here reaches.
 */
export function SubworkflowBanner({ path }: { path: string }) {
  const from = useSubworkflowNav((s) => s.from[path])
  const name = useSchemas()[subworkflowUses(path)]?.name ?? shortPath(path)
  const usedBy = useSubworkflowUsage(path)
  const count = usedBy?.length ?? 0
  return (
    <div
      data-testid="subworkflow-banner"
      className="flex min-h-9 shrink-0 items-center gap-2.5 border-b px-3 py-1.5 text-[12px]"
      style={{
        background: "color-mix(in srgb, var(--flow) 8%, var(--card))",
        borderColor: "color-mix(in srgb, var(--flow) 25%, var(--border))",
      }}
    >
      {from && (
        <button
          type="button"
          onClick={() => openWorkspaceFile(from)}
          title={`Back to ${from}`}
          className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-card py-0.5 pr-2.5 pl-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="h-3 w-3" />
          {shortPath(from)}
        </button>
      )}
      <SubworkflowIcon className="h-3.5 w-3.5 shrink-0 text-flow" />
      <span className="min-w-0 flex-1 truncate">
        <b className="font-semibold">{name}</b> is a sub-workflow
        {usedBy === null ? (
          "."
        ) : count === 0 ? (
          ". No workflow uses it yet."
        ) : (
          <>
            {" "}
            used by{" "}
            <span title={usedBy.join("\n")} className="underline decoration-dotted">
              {count} {count === 1 ? "workflow" : "workflows"}
            </span>
            . Changes here apply to all of them.
          </>
        )}
      </span>
      <span className="hidden shrink-0 text-muted-foreground md:inline">
        Input and Output define its ports
      </span>
    </div>
  )
}
