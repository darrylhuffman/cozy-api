import { useDebugSessionStore } from "@/store/debug-session"

export function RunPicker() {
  const runs = useDebugSessionStore((s) => s.runs)
  const selectedRunId = useDebugSessionStore((s) => s.selectedRunId)
  const selectRun = useDebugSessionStore((s) => s.selectRun)
  if (runs.length === 0) return null
  const selected = runs.find((r) => r.runId === selectedRunId) ?? runs[0]!
  return (
    <select
      className="rounded-md border bg-background px-2 py-1 text-[10px]"
      value={selected.runId}
      onChange={(e) => selectRun(e.target.value)}
    >
      {runs.map((r) => (
        <option key={r.runId} value={r.runId}>
          {new Date(r.startedAt).toLocaleTimeString()} · {r.request.method} {r.request.path} ·{" "}
          {r.outcome.kind === "running"
            ? "…"
            : r.outcome.kind === "ok"
              ? `${r.outcome.status} (${r.outcome.totalMs}ms)`
              : `err`}
        </option>
      ))}
    </select>
  )
}
