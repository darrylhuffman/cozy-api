import { useEffect } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useDebugSessionStore } from "@/store/debug-session"
import type { WorkflowFile } from "@/lib/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

function defaultBodyKindForMethod(method: string): "json" | "none" {
  const upper = method.toUpperCase()
  return upper === "POST" || upper === "PUT" || upper === "PATCH"
    ? "json"
    : "none"
}

function pickTrigger(t: Trigger) {
  const bodyKind = defaultBodyKindForMethod(t.method)
  const headers: Array<[string, string]> =
    bodyKind === "none" ? [] : [["Content-Type", "application/json"]]
  useDebugSessionStore.getState().setRequestForm(() => ({
    triggerNodeId: t.nodeId,
    method: t.method,
    path: t.path,
    bodyKind,
    body: "",
    formBody: [],
    query: [],
    headers,
  }))
}

export function TriggerSelector() {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const selected = useDebugSessionStore((s) => s.requestForm.triggerNodeId)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const triggers = discoverTriggers(workflow)

  useEffect(() => {
    if (triggers.length === 0 && selected !== null) {
      setRequestForm(() => ({
        triggerNodeId: null,
        method: "GET",
        path: "/",
        bodyKind: "none",
        body: "",
        formBody: [],
        query: [],
        headers: [],
      }))
      return
    }
    if (triggers.length >= 1 && (selected === null || !triggers.find((t) => t.nodeId === selected))) {
      pickTrigger(triggers[0]!)
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

  const current = triggers.find((t) => t.nodeId === selected) ?? triggers[0]!

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Trigger:</span>
      <Select
        value={current.nodeId}
        onValueChange={(id) => {
          const t = triggers.find((tr) => tr.nodeId === id)
          if (t) pickTrigger(t)
        }}
      >
        <SelectTrigger className="h-7 min-w-[180px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {triggers.map((t) => (
            <SelectItem key={t.nodeId} value={t.nodeId}>
              <span className="font-mono">{t.method}</span> {t.path}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
