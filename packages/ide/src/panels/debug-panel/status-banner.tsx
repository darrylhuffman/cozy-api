import { useDebugSessionStore } from "@/store/debug-session"

export function StatusBanner({ runId }: { runId: string | null }) {
  const run = useDebugSessionStore((s) =>
    runId ? s.runs.find((r) => r.runId === runId) ?? null : null,
  )
  const sendContinue = useDebugSessionStore((s) => s.sendContinue)
  const sendStep = useDebugSessionStore((s) => s.sendStep)
  const sendStepOver = useDebugSessionStore((s) => s.sendStepOver)
  const sendStop = useDebugSessionStore((s) => s.sendStop)

  if (!run) return null
  const out = run.outcome
  if (out.kind === "running") {
    return (
      <BannerShell label="▶ Running…">
        <ControlButton variant="danger" onClick={() => sendStop(run.runId)}>Stop</ControlButton>
      </BannerShell>
    )
  }
  if (out.kind === "paused" && run.pausedFrame) {
    return (
      <BannerShell label={`⏸ Paused at ${run.pausedFrame.nodeId}.${run.pausedFrame.phase}`}>
        <ControlButton onClick={() => sendContinue(run.runId)}>Continue</ControlButton>
        <ControlButton onClick={() => sendStep(run.runId)}>Step</ControlButton>
        {run.pausedFrame.phase === "before" && (
          <ControlButton onClick={() => sendStepOver(run.runId)}>Step Over</ControlButton>
        )}
        <ControlButton variant="danger" onClick={() => sendStop(run.runId)}>Stop</ControlButton>
      </BannerShell>
    )
  }
  if (out.kind === "ok") {
    return <BannerShell label={`✓ Completed (${out.status}, ${out.totalMs}ms)`} />
  }
  if (out.kind === "errored") {
    return <BannerShell label={`✕ Errored: ${out.message}`} variant="error" />
  }
  return null
}

function BannerShell({
  label,
  children,
  variant,
}: {
  label: string
  children?: React.ReactNode
  variant?: "error"
}) {
  return (
    <div
      className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-xs"
      data-testid="status-banner"
    >
      <div className={variant === "error" ? "text-red-700" : ""}>{label}</div>
      {children && <div className="flex gap-1">{children}</div>}
    </div>
  )
}

function ControlButton({
  onClick,
  children,
  variant,
}: {
  onClick: () => void
  children: React.ReactNode
  variant?: "danger"
}) {
  return (
    <button
      type="button"
      className={
        variant === "danger"
          ? "rounded-md border bg-background px-2 py-1 text-red-700 hover:bg-accent"
          : "rounded-md border bg-background px-2 py-1 hover:bg-accent"
      }
      onClick={onClick}
    >
      {children}
    </button>
  )
}
