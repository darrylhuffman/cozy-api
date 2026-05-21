import { useEffect, useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  fetchWorkspaceSchemas,
  type JsonSchema,
  type NodeSchemas,
} from "@/lib/api"
import { useSelectionStore } from "@/store/selection"
import { useLiveWorkflowStore } from "@/store/live-workflow"

export function InspectorPanel() {
  return (
    <Tabs defaultValue="inspect" className="flex h-full flex-col">
      <TabsList className="m-2 grid w-[calc(100%-1rem)] grid-cols-3">
        <TabsTrigger value="inspect">Inspect</TabsTrigger>
        <TabsTrigger value="tests">Tests</TabsTrigger>
        <TabsTrigger value="run">Run</TabsTrigger>
      </TabsList>
      <TabsContent value="inspect" className="flex-1 overflow-auto p-3">
        <InspectContent />
      </TabsContent>
      <TabsContent value="tests" className="flex-1 overflow-auto p-3">
        <PlaceholderCard
          title="Tests"
          body="Workflow + node test list, pass/fail status, run controls."
        />
      </TabsContent>
      <TabsContent value="run" className="flex-1 overflow-auto p-3">
        <PlaceholderCard title="Run" body="Request input, timeline, step controls during runs." />
      </TabsContent>
    </Tabs>
  )
}

function InspectContent() {
  const selectedId = useSelectionStore((s) => s.selectedNodeId)
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const [schemas, setSchemas] = useState<Record<string, NodeSchemas>>({})

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

  if (!selectedId) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
        No node selected.
      </div>
    )
  }

  const instance = workflow?.nodes[selectedId]
  if (!instance) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
        Node &quot;{selectedId}&quot; not found in the active workflow.
      </div>
    )
  }

  const schema = schemas[instance.uses]

  return (
    <div className="flex flex-col gap-4">
      <Section label="Node">
        <Row k="id" v={selectedId} />
        <Row k="uses" v={instance.uses} />
        {schema?.color && (
          <Row
            k="color"
            v={
              <span className="flex items-center gap-2">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: schema.color }}
                />
                <span>{schema.color}</span>
              </span>
            }
          />
        )}
      </Section>
      <Section label="Inputs">
        <SchemaTree {...(schema?.inputs ? { schema: schema.inputs } : {})} />
      </Section>
      <Section label="Outputs">
        <SchemaTree {...(schema?.outputs ? { schema: schema.outputs } : {})} />
      </Section>
      <Section label="Config">
        {instance.config ? (
          <pre className="rounded bg-muted p-2 text-xs overflow-auto">
            {JSON.stringify(instance.config, null, 2)}
          </pre>
        ) : (
          <div className="text-xs italic text-muted-foreground">(none)</div>
        )}
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted-foreground">{k}:</span>
      <span className="font-mono">{v}</span>
    </div>
  )
}

function SchemaTree({ schema }: { schema?: JsonSchema }) {
  if (!schema || schema.type !== "object" || !schema.properties) {
    return <div className="text-xs italic text-muted-foreground">(empty)</div>
  }
  return (
    <ul className="font-mono text-xs">
      {Object.entries(schema.properties).map(([k, sub]) => (
        <li key={k} className="py-0.5">
          <span>{k}</span>
          <span className="ml-2 text-muted-foreground">({typeOf(sub)})</span>
        </li>
      ))}
    </ul>
  )
}

function typeOf(s?: JsonSchema): string {
  if (!s) return "any"
  if (typeof s.type === "string") return s.type
  return "any"
}

function PlaceholderCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3 text-sm">
      <div className="mb-1 font-medium">{title}</div>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  )
}
