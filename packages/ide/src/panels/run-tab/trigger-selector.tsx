import { useEffect } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useDebugSessionStore } from "@/store/debug-session"
import type { WorkflowFile } from "@/lib/api"

interface Trigger {
  nodeId: string
  method: string
  path: string
}

function discoverTriggers(workflow: WorkflowFile | null): Trigger[] {
  if (!workflow) return []
  const triggers: Trigger[] = []
  for (const [nodeId, instance] of Object.entries(workflow.nodes)) {
    if (instance.uses !== "@core/http-request") continue
    const values = (instance.values ?? {}) as Record<string, unknown>
    triggers.push({
      nodeId,
      method: (values.method as string | undefined) ?? "GET",
      path: (values.path as string | undefined) ?? "/",
    })
  }
  return triggers
}

export function TriggerSelector() {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const selected = useDebugSessionStore((s) => s.requestForm.triggerNodeId)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)

  const triggers = discoverTriggers(workflow)

  // Auto-select single trigger; clear selection when triggers list changes.
  useEffect(() => {
    if (triggers.length === 0 && selected !== null) {
      setRequestForm((cur) => ({ ...cur, triggerNodeId: null }))
      return
    }
    if (triggers.length === 1 && selected !== triggers[0]!.nodeId) {
      const t = triggers[0]!
      setRequestForm(() => ({
        triggerNodeId: t.nodeId,
        method: t.method,
        path: t.path,
        body: "",
        query: [],
        headers: [],
      }))
      return
    }
    if (selected && !triggers.find((t) => t.nodeId === selected)) {
      setRequestForm((cur) => ({ ...cur, triggerNodeId: null }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggers.length, triggers.map((t) => t.nodeId).join("|")])

  if (triggers.length === 0) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
        Add an <code>@core/http-request</code> node to debug this workflow.
      </div>
    )
  }
  if (triggers.length === 1) {
    return null
  }
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Trigger:</span>
      <select
        className="rounded-md border bg-background px-2 py-1"
        value={selected ?? ""}
        onChange={(e) => {
          const id = e.target.value
          const t = triggers.find((tr) => tr.nodeId === id)
          if (!t) return
          setRequestForm(() => ({
            triggerNodeId: t.nodeId,
            method: t.method,
            path: t.path,
            body: "",
            query: [],
            headers: [],
          }))
        }}
      >
        {triggers.map((t) => (
          <option key={t.nodeId} value={t.nodeId}>
            {t.method} {t.path}
          </option>
        ))}
      </select>
    </label>
  )
}
