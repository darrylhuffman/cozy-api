import { nodeFileForUses } from "@darrylondil/lorien-runtime/cases"
import { Code, Sparkles } from "lucide-react"
import { useState } from "react"
import { askAi } from "@/ai/ask"
import { explainNode } from "@/ai/prompts"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { JsonSchema, NodeInstance } from "@/lib/api"
import { openCodeFile } from "@/lib/open-code-file"
import { cn } from "@/lib/utils"
import { type InspectorTab, useInspectorTab } from "@/store/inspector-tab"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { caseSummary, useNodeCases } from "@/store/node-cases"
import { useSchemas } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import { useWorkflowDrafts } from "@/store/workflow-drafts"
import { isValidNodeId } from "@/workflow/diagnose"
import { renameNode } from "@/workflow/graph-ops"
import { expandTemplate } from "@/workflow/template"
import { AgentsPanel } from "./agents/agents-panel"
import { RunTab } from "./run-tab"
import { TestsTab } from "./tests-tab"

export function InspectorPanel() {
  const tab = useInspectorTab((s) => s.tab)
  const setTab = useInspectorTab((s) => s.setTab)
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as InspectorTab)}
      className="flex h-full flex-col gap-0 bg-card"
    >
      <div className="border-b border-border p-2">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="tests" className="gap-1">
            Tests
            <TestsCount />
          </TabsTrigger>
          <TabsTrigger value="run">Run</TabsTrigger>
          <TabsTrigger value="agents" className="gap-1">
            <Sparkles aria-hidden className="h-3 w-3 text-ai" />
            Agents
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="inspect" className="flex-1 overflow-auto p-3">
        <InspectContent />
      </TabsContent>
      <TabsContent value="tests" className="flex-1 overflow-auto p-3">
        <TestsTab />
      </TabsContent>
      <TabsContent value="run" className="flex-1 overflow-auto p-3">
        <RunTab />
      </TabsContent>
      <TabsContent value="agents" className="min-h-0 flex-1 overflow-hidden">
        <AgentsPanel />
      </TabsContent>
    </Tabs>
  )
}

/** "passed/run" for the active workflow's node tests, once any have run. */
function TestsCount() {
  const files = useLiveWorkflowStore((s) => {
    const seen = new Set<string>()
    for (const inst of Object.values(s.workflow?.nodes ?? {})) {
      const file = nodeFileForUses(inst.uses)
      if (file) seen.add(file)
    }
    return [...seen].sort().join("\n")
  })
  const key = useNodeCases((s) => {
    let passed = 0
    let failed = 0
    for (const file of files ? files.split("\n") : []) {
      const sum = caseSummary(s, file)
      if (sum) {
        passed += sum.passed
        failed += sum.failed
      }
    }
    return passed + failed === 0 ? "" : `${passed}/${passed + failed}`
  })
  if (!key) return null
  const [passed, run] = key.split("/")
  const failing = passed !== run
  return (
    <span
      aria-hidden
      title={`${key} passing`}
      className={cn(
        "rounded-full px-1.5 font-mono text-[10px]",
        failing ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success",
      )}
    >
      {key}
    </span>
  )
}

const EMPTY_STATE = "rounded-md bg-muted/40 px-3 py-2.5 text-[13px] text-muted-foreground"

function InspectContent() {
  const selectedId = useSelectionStore((s) => s.selectedNodeId)
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const schemas = useSchemas()

  if (!selectedId) {
    return <div className={EMPTY_STATE}>No node selected.</div>
  }

  const instance = workflow?.nodes[selectedId]
  if (!instance) {
    return (
      <div className={EMPTY_STATE}>
        Node &quot;{selectedId}&quot; not found in the active workflow.
      </div>
    )
  }

  const schema = schemas[instance.uses]
  const color = schema?.color ?? null
  const sourcePath = instance.uses.startsWith("./") ? `${instance.uses.slice(2)}.ts` : null

  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <Section label="Node" color={color}>
        <NodeIdField
          key={selectedId}
          id={selectedId}
          tabId={liveTabId}
          existing={Object.keys(workflow?.nodes ?? {})}
        />
        <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
          <dt className="text-muted-foreground">Uses</dt>
          <dd className="truncate font-mono text-xs" title={instance.uses}>
            {instance.uses}
          </dd>
          {color && (
            <>
              <dt className="text-muted-foreground">Color</dt>
              <dd className="flex min-w-0 items-center gap-1.5">
                <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: color }} />
                <span className="truncate">{color}</span>
              </dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap gap-1.5">
          {sourcePath && (
            <button
              type="button"
              onClick={() => openCodeFile(sourcePath)}
              className={ACTION_BUTTON}
            >
              <Code aria-hidden className="h-3 w-3" />
              View source
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              askAi(
                explainNode({
                  workflowPath,
                  workflow,
                  nodeId: selectedId,
                  uses: instance.uses,
                  schema,
                }),
              )
            }
            className={`${ACTION_BUTTON} border-ai/30 bg-ai/10 text-ai hover:bg-ai/20`}
          >
            <Sparkles aria-hidden className="h-3 w-3" />
            Explain
          </button>
        </div>
      </Section>
      {schema?.description && (
        <Section label="Description">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
            {schema.description}
          </p>
        </Section>
      )}
      <Section label="Inputs" gap="tight">
        <SchemaTree
          {...(schema?.inputs ? { schema: schema.inputs } : {})}
          instance={instance}
          workflowPath={workflowPath}
        />
      </Section>
      <Section label="Outputs" gap="tight">
        <SchemaTree {...(schema?.outputs ? { schema: schema.outputs } : {})} />
      </Section>
    </div>
  )
}

const ACTION_BUTTON =
  "flex h-[26px] items-center gap-1.5 rounded-md border border-input px-2.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

type EffectiveValue =
  | { kind: "reference"; value: string }
  | { kind: "literal"; value: unknown }
  | { kind: "default"; value: unknown }

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
): EffectiveValue | null {
  if (typeof instance.in === "object" && instance.in !== null && portId in instance.in) {
    return { kind: "reference", value: instance.in[portId] as string }
  }
  if (instance.values && portId in instance.values) {
    return { kind: "literal", value: instance.values[portId] }
  }
  if (schema.default !== undefined) {
    return { kind: "default", value: expandTemplate(schema.default, { workflowPath }) }
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
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        Id
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
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60 aria-[invalid]:border-destructive"
        />
      </label>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}

function Section({
  label,
  color,
  gap = "normal",
  children,
}: {
  label: string
  /** Node accent colour, drawn as a small square before the label. */
  color?: string | null
  gap?: "normal" | "tight"
  children: React.ReactNode
}) {
  return (
    <section className={`flex flex-col ${gap === "tight" ? "gap-1" : "gap-2.5"}`}>
      <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {color && (
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: color }}
          />
        )}
        {label}
      </h3>
      {children}
    </section>
  )
}

function SchemaTree({
  schema,
  instance,
  workflowPath,
}: {
  schema?: JsonSchema
  /** When set, the top-level rows show the effective value alongside the type. */
  instance?: NodeInstance
  workflowPath?: string
}) {
  if (!schema || schema.type !== "object" || !schema.properties) {
    return <div className="px-2 text-xs italic text-muted-foreground">(empty)</div>
  }
  return (
    <ul className="flex flex-col gap-1">
      {Object.entries(schema.properties).map(([key, sub]) => (
        <SchemaTreeRow
          key={key}
          name={key}
          schema={sub}
          depth={0}
          effectiveValue={
            instance ? effectiveInputValue(key, sub, instance, workflowPath ?? "") : null
          }
        />
      ))}
    </ul>
  )
}

const VALUE_TONE: Record<EffectiveValue["kind"], string> = {
  reference: "text-primary",
  literal: "text-foreground",
  default: "italic text-muted-foreground",
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
  effectiveValue?: EffectiveValue | null
}) {
  const isObject = schema.type === "object" && schema.properties
  const isArray = schema.type === "array" && schema.items
  const isExpandable = Boolean(isObject ?? isArray)
  const [expanded, setExpanded] = useState(depth === 0)

  // Top-level rows are compact tinted pills; nested rows sit indented under
  // their parent without a background.
  const rowClass = `flex h-[26px] min-w-0 items-center gap-2 rounded-md px-2 ${
    depth === 0 ? "bg-muted/40" : "text-foreground/85"
  }`
  const indent = depth > 0 ? { paddingLeft: `${8 + depth * 18}px` } : undefined

  const label = (
    <>
      <span className="shrink-0 font-mono">{name}</span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{describeType(schema)}</span>
      {effectiveValue && (
        <span
          className={`ml-auto truncate pl-2 font-mono text-[11px] ${VALUE_TONE[effectiveValue.kind]}`}
          title={formatEffectiveValue(effectiveValue)}
        >
          {formatEffectiveValue(effectiveValue)}
        </span>
      )}
    </>
  )

  if (!isExpandable) {
    return (
      <li style={indent} className={rowClass}>
        {label}
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((x) => !x)}
        style={indent}
        className={`${rowClass} w-full text-left hover:bg-accent/60`}
      >
        <span aria-hidden className="w-2.5 shrink-0 text-[10px] text-muted-foreground">
          {expanded ? "▾" : "▸"}
        </span>
        {label}
      </button>
      {expanded && (
        <ul className="flex flex-col">
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

function formatEffectiveValue(v: EffectiveValue): string {
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
  if (Array.isArray(s.enum)) return "enum"
  if (s.format) return `${s.type}:${s.format}`
  if (typeof s.type === "string") return s.type
  return "any"
}
