import { useEffect, useState } from "react"
import { fetchItemUsage } from "@/lib/api"
import { subscribeToFileEvents } from "@/lib/events"

/**
 * The workflows and sub-workflows that use the sub-workflow at `path`, kept
 * fresh as workflow files change. Null until the first answer arrives, or
 * when `path` is null.
 */
export function useSubworkflowUsage(path: string | null): string[] | null {
  const [usedBy, setUsedBy] = useState<string[] | null>(null)
  useEffect(() => {
    setUsedBy(null)
    if (!path) return
    let alive = true
    const load = () =>
      fetchItemUsage(path)
        .then((r) => alive && setUsedBy(r.usedBy))
        .catch(() => alive && setUsedBy([]))
    void load()
    const unsubscribe = subscribeToFileEvents((e) => {
      if (e.type === "ready" || e.path.endsWith(".workflow")) void load()
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [path])
  return usedBy
}
