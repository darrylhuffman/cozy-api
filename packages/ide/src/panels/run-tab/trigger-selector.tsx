import { useEffect, useState } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useDebugSessionStore } from "@/store/debug-session"
import {
  fetchWorkspaceSchemas,
  type NodeSchemas,
  type WorkflowFile,
} from "@/lib/api"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { discoverTriggerConsumers } from "./discover-trigger-consumers"
import { sampleFromSchema } from "./sample-from-schema"

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

function pickTrigger(
  t: Trigger,
  workflow: WorkflowFile | null,
  schemas: Record<string, NodeSchemas>,
) {
  const consumed = workflow
    ? discoverTriggerConsumers(workflow, t.nodeId, schemas)
    : { body: null, query: null, headers: null }

  // Body
  const hasBodyShape = consumed.body !== null
  const bodyKind: "none" | "json" =
    hasBodyShape ? "json" : defaultBodyKindForMethod(t.method)
  const sampleBody = hasBodyShape ? sampleFromSchema(consumed.body) : null
  const bodyText =
    sampleBody !== null ? JSON.stringify(sampleBody, null, 2) : ""

  // Query rows
  const queryRows: Array<[string, string]> =
    consumed.query?.type === "object" && consumed.query.properties
      ? Object.keys(consumed.query.properties).map((k) => [k, ""])
      : []

  // Header rows + auto-set Content-Type when body has shape
  const headerRows: Array<[string, string]> = []
  if (consumed.headers?.type === "object" && consumed.headers.properties) {
    for (const k of Object.keys(consumed.headers.properties)) {
      headerRows.push([k, ""])
    }
  }
  if (
    bodyKind === "json" &&
    !headerRows.some(([k]) => k.toLowerCase() === "content-type")
  ) {
    headerRows.push(["Content-Type", "application/json"])
  }

  useDebugSessionStore.getState().setRequestForm((cur) => {
    const bodyEmpty = cur.body.trim().length === 0
    const queryEmpty = cur.query.length === 0
    const headersEmpty = cur.headers.length === 0
    return {
      triggerNodeId: t.nodeId,
      method: t.method,
      path: t.path,
      bodyKind,
      body: bodyEmpty ? bodyText : cur.body,
      formBody: [],
      query: queryEmpty ? queryRows : cur.query,
      headers: headersEmpty ? headerRows : cur.headers,
    }
  })
}

export function TriggerSelector() {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const selected = useDebugSessionStore((s) => s.requestForm.triggerNodeId)
  const setRequestForm = useDebugSessionStore((s) => s.setRequestForm)
  const [schemas, setSchemas] = useState<Record<string, NodeSchemas>>({})

  const triggers = discoverTriggers(workflow)

  // Fetch schemas once on mount; cache locally
  useEffect(() => {
    let alive = true
    fetchWorkspaceSchemas()
      .then((s) => {
        if (alive) setSchemas(s)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Auto-select / form-reset effect
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
    if (
      triggers.length >= 1 &&
      (selected === null || !triggers.find((t) => t.nodeId === selected))
    ) {
      pickTrigger(triggers[0]!, workflow, schemas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggers.length, triggers.map((t) => t.nodeId).join("|")])

  // Late-arrival effect: when schemas finish loading after a trigger is
  // already selected, re-run pickTrigger so pre-fill can kick in. The
  // empty-check inside pickTrigger guards against clobbering user edits.
  useEffect(() => {
    if (!workflow || !selected || Object.keys(schemas).length === 0) return
    const t = triggers.find((tr) => tr.nodeId === selected)
    if (t) pickTrigger(t, workflow, schemas)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas])

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
          if (t) pickTrigger(t, workflow, schemas)
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
