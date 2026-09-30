import { AlertTriangle, XCircle } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface NoticeAction {
  label: string
  onClick: () => void
}

/**
 * A banner floated over the canvas for states the user must notice: save
 * failures, disk conflicts, unavailable schemas. Keeps the message and the
 * way out (Retry, Reload, Dismiss) in one place.
 */
export function EditorNotice({
  tone,
  title,
  children,
  actions = [],
}: {
  tone: "warning" | "error"
  title: string
  children?: ReactNode
  actions?: NoticeAction[]
}) {
  const Icon = tone === "error" ? XCircle : AlertTriangle
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "pointer-events-auto flex w-full max-w-xl items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-sm backdrop-blur",
        tone === "error"
          ? "border-destructive/40 bg-destructive/10 text-destructive"
          : "border-warning/40 bg-warning/10 text-warning",
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        {children && <div className="mt-0.5 break-words text-foreground/80">{children}</div>}
      </div>
      {actions.length > 0 && (
        <div className="flex shrink-0 gap-1">
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="rounded border border-current/30 px-2 py-0.5 font-medium hover:bg-background/60"
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
