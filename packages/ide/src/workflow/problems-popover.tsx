import { AlertTriangle, CheckCircle2, Sparkles, XCircle } from "lucide-react"
import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { Diagnostic } from "./diagnose"

/**
 * Toolbar button showing the workflow's problem count; opens a list where
 * each entry jumps to (selects and centres) the node it concerns.
 */
export function ProblemsPopover({
  diagnostics,
  onFocusNode,
  onAskAi,
}: {
  diagnostics: Diagnostic[]
  onFocusNode: (nodeId: string) => void
  /** Renders "Fix with AI" under the list. */
  onAskAi?: () => void
}) {
  const [open, setOpen] = useState(false)
  const errors = diagnostics.filter((d) => d.severity === "error").length
  const warnings = diagnostics.length - errors
  const label =
    diagnostics.length === 0
      ? "No problems"
      : [
          errors && `${errors} error${errors === 1 ? "" : "s"}`,
          warnings && `${warnings} warning${warnings === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(", ")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Problems: ${label}`}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-accent",
            errors > 0
              ? "text-destructive"
              : warnings > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-muted-foreground",
          )}
        >
          {errors > 0 ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : warnings > 0 ? (
            <AlertTriangle className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-1">
        {diagnostics.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No problems found in this workflow.
          </div>
        ) : (
          <ul className="max-h-80 overflow-auto" aria-label="Problems">
            {diagnostics.map((d) => (
              <li key={d.key}>
                <button
                  type="button"
                  disabled={!d.nodeId}
                  onClick={() => {
                    if (!d.nodeId) return
                    setOpen(false)
                    onFocusNode(d.nodeId)
                  }}
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent disabled:hover:bg-transparent"
                >
                  {d.severity === "error" ? (
                    <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <span className="min-w-0">
                    {d.nodeId && <span className="mr-1 font-mono font-medium">{d.nodeId}</span>}
                    <span className="text-foreground/80">{d.message}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {diagnostics.length > 0 && onAskAi && (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onAskAi()
            }}
            className="mt-1 flex w-full items-center gap-1.5 rounded border-t px-2 py-1.5 text-left text-xs text-violet-600 hover:bg-accent dark:text-violet-400"
          >
            <Sparkles className="h-3.5 w-3.5" /> Fix these with AI
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
