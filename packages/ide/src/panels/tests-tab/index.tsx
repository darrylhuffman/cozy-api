import { nodeFileForUses } from "@darrylondil/lorien-runtime/cases"
import { Play } from "lucide-react"
import { useMemo } from "react"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useNodeCases } from "@/store/node-cases"
import { useSchemas } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"
import { isSubworkflowPath, subworkflowUses } from "@/workflow/subworkflow"
import { NodeCasesGroup } from "./node-cases-group"
import { WorkflowTests } from "./workflow-tests"

/**
 * The active workflow's tests: workflow tests (its saved requests, run end to
 * end) and the cases of every local node it uses, the selected node's first.
 */
export function TestsTab() {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const liveTabId = useLiveWorkflowStore((s) => s.tabId)
  const workflowPath = useTabsStore((s) => s.tabs.find((t) => t.id === liveTabId)?.path ?? "")
  const selectedId = useSelectionStore((s) => s.selectedNodeId)
  const schemas = useSchemas()
  const runError = useNodeCases((s) => s.runError)
  const logs = useNodeCases((s) => s.lastLogs)
  const anyRunning = useNodeCases((s) => Object.values(s.running).some(Boolean))

  // Cases for each local node and sub-workflow it uses; in a sub-workflow's
  // own tab, its cases first.
  const nodes = useMemo(() => {
    const seen = new Map<string, string>()
    if (isSubworkflowPath(workflowPath)) seen.set(subworkflowUses(workflowPath), workflowPath)
    for (const inst of Object.values(workflow?.nodes ?? {})) {
      const file = schemas[inst.uses]?.subworkflow?.path ?? nodeFileForUses(inst.uses)
      if (file && !seen.has(inst.uses)) seen.set(inst.uses, file)
    }
    return [...seen].map(([uses, file]) => ({ uses, file }))
  }, [workflow, workflowPath, schemas])

  if (!workflow) {
    return (
      <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
        Open a workflow to see and run its tests.
      </div>
    )
  }

  const selectedUses = selectedId ? workflow.nodes[selectedId]?.uses : undefined
  const ordered = isSubworkflowPath(workflowPath)
    ? nodes
    : [...nodes].sort((a, b) => Number(b.uses === selectedUses) - Number(a.uses === selectedUses))

  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="tests-tab">
      {workflowPath && <WorkflowTests key={workflowPath} workflowPath={workflowPath} />}
      <div className="mt-2 flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Node tests</div>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Run all node tests"
          disabled={nodes.length === 0 || anyRunning}
          onClick={() => void useNodeCases.getState().run(nodes.map((n) => n.file))}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
          {anyRunning ? "Running…" : "Run all"}
        </button>
      </div>
      {runError && (
        <div
          role="alert"
          className="whitespace-pre-wrap rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-destructive"
        >
          {runError}
        </div>
      )}
      {nodes.length === 0 ? (
        <div className="rounded-md border border-dashed p-2 text-muted-foreground">
          This workflow only uses built-in nodes. Cases are for your own nodes under{" "}
          <code>nodes/</code>.
        </div>
      ) : (
        ordered.map((n) => (
          <NodeCasesGroup
            key={n.file}
            nodeFile={n.file}
            uses={n.uses}
            schema={schemas[n.uses]}
            workflow={workflow}
            workflowPath={workflowPath}
            highlighted={n.uses === selectedUses || n.file === workflowPath}
          />
        ))
      )}
      <p className="text-[11px] text-muted-foreground">
        Cases are saved next to each node as <code>.cases.json</code> and run in CI with{" "}
        <code>lorien test</code>.
      </p>
      {logs && (
        <details>
          <summary className="text-muted-foreground">Output from the last run</summary>
          <pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[10px]">{logs}</pre>
        </details>
      )}
    </div>
  )
}
