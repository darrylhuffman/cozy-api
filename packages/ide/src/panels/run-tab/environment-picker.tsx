import { ENVIRONMENTS_FILE } from "@darrylondil/lorien-runtime/requests"
import { useEffect } from "react"
import { ApiError, createWorkspaceFile } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"
import { openCodeFile } from "@/lib/open-code-file"
import { activeEnvironment, ENVIRONMENTS_TEMPLATE, useEnvironments } from "@/store/environments"

/** Environment dropdown plus a shortcut to edit the shared environments file. */
export function EnvironmentPicker() {
  const envs = useEnvironments((s) => s.envs)
  const selected = useEnvironments((s) => s.selected)
  const error = useEnvironments((s) => s.error)
  const loaded = useEnvironments((s) => s.loaded)
  const { name } = activeEnvironment({ envs, selected })
  const names = Object.keys(envs.environments)

  useEffect(() => {
    if (!useEnvironments.getState().loaded) void useEnvironments.getState().load()
    return subscribeToFileEvents((e) => {
      if (e.path.startsWith("lorien.environments")) void useEnvironments.getState().load()
    })
  }, [])

  const edit = async () => {
    try {
      await createWorkspaceFile(ENVIRONMENTS_FILE, ENVIRONMENTS_TEMPLATE)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) throw e
    }
    openCodeFile(ENVIRONMENTS_FILE)
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Env</span>
      <select
        aria-label="Environment"
        className="h-6 rounded border border-border bg-background px-1 text-xs"
        value={name ?? ""}
        disabled={names.length === 0}
        onChange={(e) => useEnvironments.getState().select(e.target.value || null)}
      >
        {names.length === 0 && <option value="">{loaded ? "none" : "loading…"}</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="rounded px-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        title={`Edit ${ENVIRONMENTS_FILE} (variables like {{token}} and an optional baseUrl)`}
        onClick={() => void edit()}
      >
        {names.length === 0 ? "Add" : "Edit"}
      </button>
      {error && (
        <span className="truncate text-red-700 dark:text-red-400" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
