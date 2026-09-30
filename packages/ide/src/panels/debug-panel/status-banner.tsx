import { CircleX, Sparkles } from "lucide-react"
import { askAi } from "@/ai/ask"
import { fixFailedRun } from "@/ai/prompts"
import { cn } from "@/lib/utils"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"

type Variant = "info" | "warning" | "success" | "error"

export function StatusBanner({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? (s.runs.find((r) => r.runId === runId) ?? null) : null,
  )
  const sendContinue = useDebugSessionStore((s) => s.sendContinue)
  const sendStep = useDebugSessionStore((s) => s.sendStep)
  const sendStepOver = useDebugSessionStore((s) => s.sendStepOver)
  const sendStop = useDebugSessionStore((s) => s.sendStop)

  if (!run) return null
  const out = run.outcome
  if (out.kind === "running") {
    return (
      <BannerShell variant="info" icon={<span className="size-2 rounded-full bg-info" />}>
        <span>Running…</span>
        <Actions>
          <ControlButton variant="danger" onClick={() => sendStop(run.runId)}>
            Stop
          </ControlButton>
        </Actions>
      </BannerShell>
    )
  }
  if (out.kind === "paused" && run.pausedFrame) {
    return (
      <BannerShell variant="warning" icon={<PauseGlyph />}>
        <span>
          <span className="font-semibold text-warning">Paused</span> at{" "}
          <span className="font-mono">
            {run.pausedFrame.nodeId}.{run.pausedFrame.phase}
          </span>
        </span>
        <Actions>
          <ControlButton variant="primary" onClick={() => sendContinue(run.runId)}>
            Continue
          </ControlButton>
          <ControlButton onClick={() => sendStep(run.runId)}>Step</ControlButton>
          {run.pausedFrame.phase === "before" && (
            <ControlButton onClick={() => sendStepOver(run.runId)}>Step Over</ControlButton>
          )}
          <ControlButton variant="danger" onClick={() => sendStop(run.runId)}>
            Stop
          </ControlButton>
        </Actions>
      </BannerShell>
    )
  }
  if (out.kind === "ok") {
    return (
      <BannerShell variant="success" icon={<span className="text-success">✓</span>}>
        <span>Completed</span>
        <span className="font-mono text-[11.5px] text-muted-foreground">
          {out.status} · {out.totalMs}ms
        </span>
      </BannerShell>
    )
  }
  if (out.kind === "errored") {
    return (
      <BannerShell
        variant="error"
        icon={<CircleX aria-hidden className="size-3.5 shrink-0 text-destructive" />}
      >
        <span className="min-w-0 truncate" title={out.message}>
          <span className="font-semibold text-destructive">Errored</span>
          {out.nodeId && (
            <>
              {" in "}
              <span className="font-mono">{out.nodeId}</span>
            </>
          )}
          : {out.message}
        </span>
        <Actions>
          <button
            type="button"
            className="flex h-7 items-center gap-1.5 rounded-md bg-ai/15 px-2.5 text-xs font-medium text-ai hover:bg-ai/25"
            onClick={() => {
              const req = fixFailedRun({ run, workflow: useLiveWorkflowStore.getState().workflow })
              if (req) askAi(req)
            }}
          >
            <Sparkles aria-hidden className="size-3" />
            Ask AI to fix
          </button>
        </Actions>
      </BannerShell>
    )
  }
  return null
}

const bannerTone: Record<Variant, string> = {
  info: "bg-info/10",
  warning: "bg-warning/10",
  success: "bg-success/10",
  error: "bg-destructive/10",
}

function BannerShell({
  children,
  icon,
  variant,
}: {
  children: React.ReactNode
  icon: React.ReactNode
  variant: Variant
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-2.5 border-b border-border px-3.5 py-1.5",
        bannerTone[variant],
      )}
      data-testid="status-banner"
      data-variant={variant}
    >
      <span aria-hidden className="flex shrink-0 items-center">
        {icon}
      </span>
      {children}
    </div>
  )
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="ml-auto flex shrink-0 items-center gap-1.5">{children}</div>
}

function PauseGlyph() {
  return (
    <span className="flex gap-0.5">
      <span className="h-2.5 w-[3px] rounded-sm bg-warning" />
      <span className="h-2.5 w-[3px] rounded-sm bg-warning" />
    </span>
  )
}

function ControlButton({
  onClick,
  children,
  variant,
}: {
  onClick: () => void
  children: React.ReactNode
  variant?: "danger" | "primary"
}) {
  return (
    <button
      type="button"
      className={cn(
        "h-[26px] rounded-md px-2.5 text-xs font-medium",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "border border-border bg-background hover:bg-accent",
        variant === "danger" && "text-destructive",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
