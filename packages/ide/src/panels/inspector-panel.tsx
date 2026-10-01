import { nodeFileForUses } from "@darrylondil/lorien-runtime/cases"
import { Code, GitBranch, Sparkles, Workflow } from "lucide-react"
import { useState } from "react"
import { askAi } from "@/ai/ask"
import { explainNode } from "@/ai/prompts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { JsonSchema, NodeInstance, NodeSchemas, WorkflowFile } from "@/lib/api"
import { openCodeFile } from "@/lib/open-code-file"
import { openWorkspaceFile } from "@/lib/open-file"
import { openSubworkflow } from "@/lib/open-subworkflow"
import { cn } from "@/lib/utils"
import { type InspectorTab, useInspectorTab } from "@/store/inspector-tab"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { caseSummary, useNodeCases } from "@/store/node-cases"
import { useRequestCollections, workflowTestSummary } from "@/store/request-collections"
import { useSchemas } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import { useWorkflowDrafts } from "@/store/workflow-drafts"
import { conditionColor } from "@/workflow/condition-edge"
import { conditionOptions, parseCondition, setCondition } from "@/workflow/conditions"
import { isValidNodeId, TRIGGERS } from "@/workflow/diagnose"
import { renameNode } from "@/workflow/graph-ops"
import { SCHEDULE_USES } from "@/workflow/schedule"
import { ScheduleEditor } from "@/workflow/schedule-editor"
import {
  isSubworkflowPath,
  SUBWORKFLOW_INPUT,
  SUBWORKFLOW_OUTPUT,
  subworkflowUses,
} from "@/workflow/subworkflow"
import { SubworkflowIcon } from "@/workflow/subworkflow-icon"
import { expandTemplate } from "@/workflow/template"
import { useSubworkflowUsage } from "@/workflow/use-subworkflow-usage"
import { VARIABLE_USES } from "@/workflow/variables"
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
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
          <TabsTrigger value="tests" className="gap-1">
            Tests
            <TestsCount />
          </TabsTrigger>
          <TabsTrigger value="run">Run</TabsTrigger>
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
    </Tabs>
  )
}

/** "passed/run" for the active workflow's workflow and node tests, once any have run. */
function TestsCount() {
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const workflowPath = useTabsStore((s) => s.tabs.find((t) => t.id === liveTabId)?.path ?? "")
  const flow = useRequestCollections((s) => {
    const sum = workflowTestSummary(s, workflowPath)
    return sum ? `${sum.passed}/${sum.run}` : "0/0"
  })
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
    const [flowPassed = 0, flowRun = 0] = flow.split("/").map(Number)
    const run = passed + failed + flowRun
    return run === 0 ? "" : `${passed + flowPassed}/${run}`
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
  const selectedIds = useSelectionStore((s) => s.selectedNodeIds)
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const tabs = useTabsStore((s) => s.tabs)
  const workflowPath = tabs.find((t) => t.id === liveTabId)?.path ?? ""
  const schemas = useSchemas()

  if (selectedIds.length > 1 && workflow) {
    return <MultiSelection ids={selectedIds} workflow={workflow} schemas={schemas} />
  }

  if (!selectedId) {
    if (isSubworkflowPath(workflowPath)) {
      return (
        <div className="flex flex-col gap-5 text-[13px]">
          <div className={EMPTY_STATE}>No node selected.</div>
          <UsedIn path={workflowPath} here={workflowPath} />
        </div>
      )
    }
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
  const sub = schema?.subworkflow
  const sourcePath = instance.uses.startsWith("./") && !sub ? `${instance.uses.slice(2)}.ts` : null

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
          {sub && (
            <button
              type="button"
              onClick={() => openSubworkflow(sub.path, workflowPath)}
              className={ACTION_BUTTON}
            >
              <SubworkflowIcon className="h-3 w-3 text-flow" />
              Open sub-workflow
            </button>
          )}
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
      {sub && sub.respondsWith.length > 0 && (
        <Section label="Can respond">
          <p className="text-[12.5px] text-muted-foreground">
            A Response inside it can answer the request with{" "}
            {sub.respondsWith.map((st, i) => (
              <span key={st}>
                {i > 0 && (i === sub.respondsWith.length - 1 ? " or " : ", ")}
                <span className="font-mono text-foreground">{st}</span>
              </span>
            ))}
            .
          </p>
        </Section>
      )}
      {sub && <UsedIn path={sub.path} here={workflowPath} />}
      {instance.uses === SCHEDULE_USES && (
        <Section label="Schedule">
          <ScheduleEditor
            key={selectedId}
            nodeId={selectedId}
            instance={instance}
            tabId={liveTabId}
            workflowPath={workflowPath}
          />
        </Section>
      )}
      {workflow &&
        instance.uses !== VARIABLE_USES &&
        !TRIGGERS.has(instance.uses) &&
        !SUBWORKFLOW_PORTS.has(instance.uses) && (
          <Section label="Runs">
            <ConditionField
              id={selectedId}
              tabId={liveTabId}
              workflow={workflow}
              schemas={schemas}
            />
          </Section>
        )}
      {schema?.description && (
        <Section label="Description">
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/85">
            {schema.description}
          </p>
        </Section>
      )}
      {instance.uses !== SCHEDULE_USES && (
        <Section label="Inputs" gap="tight">
          <SchemaTree
            {...(schema?.inputs ? { schema: schema.inputs } : {})}
            instance={instance}
            workflowPath={workflowPath}
          />
        </Section>
      )}
      <Section label="Outputs" gap="tight">
        <SchemaTree {...(schema?.outputs ? { schema: schema.outputs } : {})} />
      </Section>
    </div>
  )
}

/** Several nodes selected: which ones, each a click away from inspecting it alone. */
function MultiSelection({
  ids,
  workflow,
  schemas,
}: {
  ids: string[]
  workflow: WorkflowFile
  schemas: Record<string, NodeSchemas>
}) {
  const present = ids.filter((id) => workflow.nodes[id])
  return (
    <div className="flex flex-col gap-5 text-[13px]">
      <Section label={`${present.length} nodes selected`}>
        <ul className="flex flex-col gap-0.5">
          {present.map((id) => {
            const uses = workflow.nodes[id]?.uses ?? ""
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => useSelectionStore.getState().setSelected(id)}
                  title={`Inspect ${id} on its own`}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
                >
                  <span className="truncate font-medium">{id}</span>
                  <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">
                    {schemas[uses]?.name ?? uses}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          Drag any of them to move the group. Delete removes them all, and Ctrl+Z puts them back.
          Shift+click a node to add or remove it.
        </p>
      </Section>
    </div>
  )
}

/** The workflows and sub-workflows that use the sub-workflow at `path`; each opens on click. */
function UsedIn({ path, here }: { path: string; here: string }) {
  const usedBy = useSubworkflowUsage(path)
  const name = useSchemas()[subworkflowUses(path)]?.name
  return (
    <Section label={usedBy ? `Used in ${usedBy.length}` : "Used in"}>
      {usedBy === null ? (
        <p className="text-[12.5px] text-muted-foreground">Checking…</p>
      ) : usedBy.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          Not used anywhere yet. Drag {name ?? "it"} from the Explorer onto a workflow.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {usedBy.map((p) => (
            <li key={p}>
              <button
                type="button"
                onClick={() => openWorkspaceFile(p)}
                title={`Open ${p}`}
                className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent"
              >
                {isSubworkflowPath(p) ? (
                  <SubworkflowIcon className="h-3.5 w-3.5 shrink-0 text-flow" />
                ) : (
                  <Workflow aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />
                )}
                <span className="truncate font-mono text-[12px]">
                  {p.split("/").slice(1).join("/")}
                </span>
                {p === here && (
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                    this tab
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

/** A sub-workflow's Input and Output run when the sub-workflow does; they take no condition. */
const SUBWORKFLOW_PORTS = new Set([SUBWORKFLOW_INPUT, SUBWORKFLOW_OUTPUT])

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

const ALWAYS = "$always"

/**
 * The node's `when`: always run, or only when another node's output is true
 * (or false). The same edit as drawing a condition edge on the canvas.
 */
function ConditionField({
  id,
  tabId,
  workflow,
  schemas,
}: {
  id: string
  tabId: string | null
  workflow: WorkflowFile
  schemas: Record<string, NodeSchemas>
}) {
  const condition = parseCondition(workflow.nodes[id]?.when)
  const options = conditionOptions(workflow, schemas, id)
  if (condition && !options.some((o) => o.ref === condition.ref)) {
    options.unshift({ ref: condition.ref, type: undefined })
  }
  const apply = (ref: string | null, negate: boolean) => {
    if (!tabId) return
    const drafts = useWorkflowDrafts.getState()
    const draft = drafts.drafts[tabId]
    if (!draft) return
    const next = setCondition(draft.workflow, id, ref, negate)
    if (next !== draft.workflow) drafts.apply(tabId, next)
  }
  const negate = condition?.negate ?? false

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={condition?.ref ?? ALWAYS}
        disabled={!tabId}
        onValueChange={(v) => apply(v === ALWAYS ? null : v, negate)}
      >
        <SelectTrigger
          aria-label="Condition"
          className="h-8 w-full min-w-0 bg-background px-2.5 font-mono text-[12.5px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALWAYS}>
            <span className="font-sans">Always</span>
          </SelectItem>
          {options.map((o) => (
            <SelectItem key={o.ref} value={o.ref}>
              <span className="font-sans text-muted-foreground">only if</span>
              <span className="font-mono">{o.ref}</span>
              {o.type && o.type !== "boolean" && (
                <span className="font-sans text-[11px] text-muted-foreground">{o.type}</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {condition && (
        <fieldset className="grid grid-cols-2 gap-1 rounded-md bg-muted/50 p-0.5">
          <legend className="sr-only">Branch</legend>
          {[false, true].map((neg) => {
            const on = negate === neg
            const color = conditionColor(neg)
            return (
              <button
                key={String(neg)}
                type="button"
                aria-pressed={on}
                onClick={() => apply(condition.ref, neg)}
                className={cn(
                  "flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-xs",
                  on
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <GitBranch aria-hidden className="h-3 w-3" style={on ? { color } : undefined} />
                {neg ? "when false" : "when true"}
              </button>
            )
          })}
        </fieldset>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {condition
          ? "Skipped otherwise, along with anything that reads its output."
          : "Or drag an output onto the diamond left of the node's title."}
      </p>
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
