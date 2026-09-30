import { nodeFileForUses } from "@darrylondil/lorien-runtime/cases"
import { AlertTriangle, CircleX, FlaskConical } from "lucide-react"
import { useMemo } from "react"
import { cn } from "@/lib/utils"
import { runCommand, useCommandEnabled } from "@/store/commands"
import { useDebugSessionStore } from "@/store/debug-session"
import { activeEnvironment, useEnvironments } from "@/store/environments"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { caseSummary, useNodeCases } from "@/store/node-cases"
import { useSchemas, useSchemasStore } from "@/store/schemas"
import { useTabsStore } from "@/store/tabs"
import { diagnoseWorkflow } from "@/workflow/diagnose"
import { MOD } from "@/workflow/shortcuts-dialog"

/**
 * One line along the bottom that sums up the state spread across the panels:
 * debugger connection, environment, problems and tests in the open workflow,
 * and whether the visible tab is saved.
 */
export function StatusBar() {
  const connected = useDebugSessionStore((s) => s.connected)
  const envs = useEnvironments((s) => s.envs)
  const selected = useEnvironments((s) => s.selected)
  const env = activeEnvironment({ envs, selected }).name

  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const schemas = useSchemas()
  const schemasLoaded = useSchemasStore((s) => s.loaded)
  const problems = useMemo(() => {
    if (!workflow) return null
    const all = diagnoseWorkflow(workflow, schemas, { schemasLoaded })
    const errors = all.filter((d) => d.severity === "error").length
    return { errors, warnings: all.length - errors }
  }, [workflow, schemas, schemasLoaded])

  const byNode = useNodeCases((s) => s.byNode)
  const results = useNodeCases((s) => s.results)
  const tests = useMemo(() => {
    if (!workflow) return null
    const seen = new Set<string>()
    let run = 0
    let passed = 0
    let total = 0
    for (const inst of Object.values(workflow.nodes)) {
      const file = nodeFileForUses(inst.uses)
      if (!file || seen.has(file)) continue
      seen.add(file)
      const sum = caseSummary({ byNode, results }, file)
      if (!sum) continue
      total += sum.total
      run += sum.run
      passed += sum.passed
    }
    return total === 0 ? null : { run, passed }
  }, [workflow, byNode, results])

  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeId))
  const canShowShortcuts = useCommandEnabled("help.shortcuts")

  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-border bg-card px-3 text-[11.5px] text-muted-foreground">
      <span className={cn("flex items-center gap-1.5", connected && "text-success")}>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            connected ? "bg-success" : "border border-muted-foreground",
          )}
        />
        {connected ? "Debugger connected" : "Debugger disconnected"}
      </span>
      <span>
        Env <span className="text-foreground">{env ?? "none"}</span>
      </span>
      {problems && (
        <span
          className="flex items-center gap-2"
          title={`${problems.errors} errors, ${problems.warnings} warnings in this workflow`}
        >
          <span
            className={cn("flex items-center gap-1", problems.errors > 0 && "text-destructive")}
          >
            <CircleX className="h-3 w-3" />
            {problems.errors}
          </span>
          <span className={cn("flex items-center gap-1", problems.warnings > 0 && "text-warning")}>
            <AlertTriangle className="h-3 w-3" />
            {problems.warnings}
          </span>
        </span>
      )}
      {tests && (
        <span
          className={cn(
            "flex items-center gap-1",
            tests.run > 0 && (tests.passed === tests.run ? "text-success" : "text-destructive"),
          )}
          title="Node tests in this workflow"
        >
          <FlaskConical className="h-3 w-3" />
          {tests.run === 0 ? "not run" : `${tests.passed}/${tests.run}`}
        </span>
      )}
      <span className="flex-1" />
      {activeTab && (
        <span className={cn(activeTab.dirty && "text-warning")}>
          {activeTab.dirty ? "Unsaved" : "Saved"}
        </span>
      )}
      <span>{MOD}+K add node</span>
      <button
        type="button"
        disabled={!canShowShortcuts}
        onClick={() => runCommand("help.shortcuts")}
        className="hover:text-foreground disabled:hover:text-muted-foreground"
      >
        ? shortcuts
      </button>
    </footer>
  )
}
