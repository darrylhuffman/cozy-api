import type { RequestRunResult, SavedRequest } from "@darrylondil/lorien-runtime/requests"
import { useEffect } from "react"
import { subscribeToFileEvents } from "@/lib/events"
import { activeEnvironment, useEnvironments } from "@/store/environments"
import { useRequestCollections } from "@/store/request-collections"
import { useRequestEditor } from "@/store/request-editor"
import { sendAll, sendRequest } from "./send-request"

function currentVars() {
  return activeEnvironment(useEnvironments.getState()).vars
}

function store(workflowPath: string, r: RequestRunResult) {
  useRequestCollections.getState().setResult(workflowPath, r.requestId, r)
  if (useRequestEditor.getState().editingId === r.requestId)
    useRequestEditor.getState().setLastResult(r)
}

/** Runs one saved request and keeps its result for the Run and Tests tabs. */
export async function runSaved(workflowPath: string, req: SavedRequest): Promise<void> {
  store(workflowPath, await sendRequest(req, { workflowPath, vars: currentVars() }))
}

/** Runs saved requests in order, passing captured values forward. */
export async function runAllSaved(workflowPath: string, requests: SavedRequest[]): Promise<void> {
  await sendAll(requests, {
    workflowPath,
    vars: currentVars(),
    onResult: (r) => store(workflowPath, r),
  })
}

/** Loads a workflow's `.requests.json` and reloads it when it changes outside the IDE. */
export function useCollection(workflowPath: string) {
  useEffect(() => {
    if (!workflowPath) return
    const store = useRequestCollections.getState()
    if (!store.byWorkflow[workflowPath]?.loaded) void store.load(workflowPath)
    const collectionPath = workflowPath.replace(/\.workflow$/, ".requests.json")
    return subscribeToFileEvents((e) => {
      if (e.path !== collectionPath) return
      // Our own saves echo back as change events; only reload for outside edits.
      if (useRequestCollections.getState().byWorkflow[workflowPath]?.saving) return
      void useRequestCollections.getState().load(workflowPath)
    })
  }, [workflowPath])
  return useRequestCollections((s) => s.byWorkflow[workflowPath])
}

/** Why a request failed, one line each; empty when it passed. */
export function failureLines(r: RequestRunResult): string[] {
  if (r.passed) return []
  if (r.error) return [r.error]
  const out = r.assertions.filter((a) => !a.pass).map((a) => a.message)
  if (out.length === 0 && r.response) out.push(`status ${r.response.status}`)
  if (r.missingVariables.length > 0)
    out.push(`undefined variables: ${r.missingVariables.join(", ")}`)
  return out
}
