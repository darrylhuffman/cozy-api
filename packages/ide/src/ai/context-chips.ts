import { nodeFileForUses } from "@darrylondil/lorien-runtime/cases"
import { useMemo } from "react"
import { useDebugSessionStore } from "@/store/debug-session"
import { useLiveWorkflowStore } from "@/store/live-workflow"
import { useSchemas } from "@/store/schemas"
import { useSelectionStore } from "@/store/selection"
import { useTabsStore } from "@/store/tabs"

export interface ContextChip {
  id: "workflow" | "node" | "run"
  label: string
  /** On unless the user turns it off. */
  defaultOn: boolean
  text: string
}

const fence = (label: string, v: unknown) =>
  `${label}:\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\``

/** What the IDE can attach to a chat message: the open workflow, the selected node, its last run. */
export function useContextChips(): ContextChip[] {
  const workflow = useLiveWorkflowStore((s) => s.workflow)
  const tabId = useLiveWorkflowStore((s) => s.tabId)
  const path = useTabsStore((s) => s.tabs.find((t) => t.id === tabId)?.path ?? null)
  const selectedId = useSelectionStore((s) => s.selectedNodeId)
  const runs = useDebugSessionStore((s) => s.runs)
  const schemas = useSchemas()

  return useMemo(() => {
    const chips: ContextChip[] = []
    if (!workflow || !path) return chips
    chips.push({
      id: "workflow",
      label: path.split("/").pop() ?? path,
      defaultOn: true,
      text: fence(`Open workflow ${path}`, workflow),
    })
    const node = selectedId ? workflow.nodes[selectedId] : undefined
    if (selectedId && node) {
      const schema = schemas[node.uses]
      const file = nodeFileForUses(node.uses)
      chips.push({
        id: "node",
        label: selectedId,
        defaultOn: true,
        text: [
          `Selected node: ${selectedId} (${file ?? node.uses})`,
          schema ? fence("Its schemas", { inputs: schema.inputs, outputs: schema.outputs }) : "",
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }
    const run = runs.find(
      (r) =>
        r.workflowPath === path ||
        r.workflowPath.endsWith(`/${path}`) ||
        path.endsWith(r.workflowPath),
    )
    if (run) {
      const out = run.outcome
      const failed = out.kind === "errored"
      chips.push({
        id: "run",
        label: failed
          ? "last run: failed"
          : out.kind === "ok"
            ? `last run: ${out.status}`
            : `last run: ${out.kind}`,
        defaultOn: failed,
        text: fence("Last debug run", {
          request: run.request,
          outcome: out,
          logs: run.logs.slice(-30).map((l) => `[${l.level}] ${l.message}`),
        }),
      })
    }
    return chips
  }, [workflow, path, selectedId, runs, schemas])
}
