import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { JsonSchema, NodeInstance } from "@/lib/api"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useSchemas } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import { useWorkflowDrafts } from "@/store/workflow-drafts"
import { isValidNodeId } from "@/workflow/diagnose"
import { renameNode } from "@/workflow/graph-ops"
import { expandTemplate } from "@/workflow/template"
import { RunTab } from "./run-tab"
import { TestsTab } from "./tests-tab"

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
        <TestsTab />
      </TabsContent>
      <TabsContent value="run" className="flex-1 overflow-auto p-3">
        <RunTab />
      </TabsContent>
    </Tabs>
  )
}

function InspectContent() {
  const selectedId = useSelectionStore((s) => s.selectedNodeId)
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const schemas = useSchemas()

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
        <NodeIdField
          key={selectedId}
          id={selectedId}
          tabId={liveTabId}
          existing={Object.keys(workflow?.nodes ?? {})}
        />
        <Row k="uses" v={instance.uses} />
        {schema?.color && (
          <Row
            k="color"
            v={
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-sm" style={{ background: schema.color }} />
                <span>{schema.color}</span>
              </span>
            }
          />
        )}
      </Section>
      {schema?.description && (
        <Section label="Description">
          <div className="whitespace-pre-wrap text-xs">{schema.description}</div>
        </Section>
      )}
      <Section label="Inputs">
        <SchemaTree
          {...(schema?.inputs ? { schema: schema.inputs } : {})}
          instance={instance}
          workflowPath={workflowPath}
        />
      </Section>
      <Section label="Outputs">
        <SchemaTree {...(schema?.outputs ? { schema: schema.outputs } : {})} />
      </Section>
    </div>
  )
}

/**
 * Compute the effective value the runtime will pass to a top-level input port.
 * Priority chain mirrors the inline widget:
 *   1. instance.in[port]      — a reference (rendered as the ref string)
 *   2. instance.values[port]  — a literal
 *   3. schema.default         — declarative default (template-expanded)
 *   4. undefined              — empty
 */
function effectiveInputValue(
  portId: string,
  schema: JsonSchema,
  instance: NodeInstance,
  workflowPath: string,
): { kind: "reference"; value: string } | { kind: "literal"; value: unknown } | null {
  if (typeof instance.in === "object" && instance.in !== null && portId in instance.in) {
    return { kind: "reference", value: instance.in[portId] as string }
  }
  if (instance.values && portId in instance.values) {
    return { kind: "literal", value: instance.values[portId] }
  }
  if (schema.default !== undefined) {
    return { kind: "literal", value: expandTemplate(schema.default, { workflowPath }) }
  }
  return null
}

/**
 * Editable node id. Renaming rewrites every reference to the node (`in`,
 * `after`, `view`) through the tab's draft, so it is one undoable edit.
 */
function NodeIdField({
  id,
  tabId,
  existing,
}: {
  id: string
  tabId: string | null
  existing: string[]
}) {
  const [text, setText] = useState(id)
  const trimmed = text.trim()
  const error =
    trimmed === id
      ? null
      : !isValidNodeId(trimmed)
        ? "Use letters, digits, _ or $, not starting with a digit"
        : existing.includes(trimmed)
          ? `"${trimmed}" is already used`
          : null

  const commit = () => {
    if (error || trimmed === id || !tabId) {
      setText(id)
      return
    }
    const drafts = useWorkflowDrafts.getState()
    const draft = drafts.drafts[tabId]
    if (!draft) return
    drafts.apply(tabId, renameNode(draft.workflow, id, trimmed))
    useSelectionStore.getState().setSelected(trimmed)
  }

  return (
    <div className="flex flex-col gap-0.5 text-xs">
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">id:</span>
        <input
          aria-label="Node id"
          aria-invalid={error ? true : undefined}
          value={text}
          disabled={!tabId}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur()
            if (e.key === "Escape") {
              setText(id)
              e.currentTarget.blur()
            }
          }}
          className="h-6 flex-1 rounded border border-border bg-background px-1.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-primary aria-[invalid]:border-red-500"
        />
      </label>
      {error && (
        <span role="alert" className="pl-6 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
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

function SchemaTree({
  schema,
  depth = 0,
  instance,
  workflowPath,
}: {
  schema?: JsonSchema
  depth?: number
  /** When set, the top-level rows show the effective value alongside the type. */
  instance?: NodeInstance
  workflowPath?: string
}) {
  if (!schema || schema.type !== "object" || !schema.properties) {
    return <div className="text-xs italic text-muted-foreground">(empty)</div>
  }
  return (
    <ul className="font-mono text-xs">
      {Object.entries(schema.properties).map(([key, sub]) => {
        const value =
          instance && depth === 0
            ? effectiveInputValue(key, sub, instance, workflowPath ?? "")
            : null
        return (
          <SchemaTreeRow key={key} name={key} schema={sub} depth={depth} effectiveValue={value} />
        )
      })}
    </ul>
  )
}

function SchemaTreeRow({
  name,
  schema,
  depth,
  effectiveValue,
}: {
  name: string
  schema: JsonSchema
  depth: number
  effectiveValue?: { kind: "reference"; value: string } | { kind: "literal"; value: unknown } | null
}) {
  const isObject = schema.type === "object" && schema.properties
  const isArray = schema.type === "array" && schema.items
  const isExpandable = Boolean(isObject ?? isArray)
  const [expanded, setExpanded] = useState(depth === 0)

  const indent = { paddingLeft: `${depth * 12}px` }

  if (!isExpandable) {
    return (
      <li style={indent} className="py-0.5">
        <span>{name}</span>
        <span className="ml-2 text-muted-foreground">({describeType(schema)})</span>
        {effectiveValue && (
          <span
            className={
              effectiveValue.kind === "reference"
                ? "ml-2 text-primary"
                : "ml-2 text-muted-foreground"
            }
          >
            = {formatEffectiveValue(effectiveValue)}
          </span>
        )}
      </li>
    )
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        style={indent}
        className="flex w-full items-center gap-1 py-0.5 text-left hover:bg-accent/40"
      >
        <span className="text-muted-foreground">{expanded ? "▾" : "▸"}</span>
        <span>{name}</span>
        <span className="ml-2 text-muted-foreground">({describeType(schema)})</span>
      </button>
      {expanded && (
        <ul>
          {isObject &&
            Object.entries(schema.properties!).map(([k, s]) => (
              <SchemaTreeRow key={k} name={k} schema={s} depth={depth + 1} />
            ))}
          {isArray && schema.items && (
            <SchemaTreeRow name="[]" schema={schema.items} depth={depth + 1} />
          )}
        </ul>
      )}
    </li>
  )
}

function formatEffectiveValue(
  v: { kind: "reference"; value: string } | { kind: "literal"; value: unknown },
): string {
  if (v.kind === "reference") return v.value
  const lit = v.value
  if (typeof lit === "string") return JSON.stringify(lit)
  if (lit === null || lit === undefined) return String(lit)
  if (typeof lit === "object") return JSON.stringify(lit)
  return String(lit)
}

function describeType(s: JsonSchema): string {
  if (s.type === "object") return "object"
  if (s.type === "array") return "array"
  if (Array.isArray(s.enum)) return `enum(${s.enum.length})`
  if (s.format) return `${s.type}:${s.format}`
  if (typeof s.type === "string") return s.type
  return "any"
}
