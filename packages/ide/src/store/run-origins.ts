import type { NodeFrame } from "@darrylondil/lorien-runtime"
import type { NodeStatus, RunRecord } from "./debug-session"

/**
 * A run executes its workflow with every sub-workflow node flattened in: the
 * nodes inside `ReserveSeats` run as `ReserveSeats__FindEvent` and so on. The
 * server says where each of those was written (`run.origins`), so the canvas
 * and the timeline can show them in the file they belong to.
 */

/** True when a run's workflow path and a tab's path name the same file. */
export function samePath(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)
}

/** Where a node of the run was written, outermost file first. */
export function framesOf(
  run: Pick<RunRecord, "workflowPath" | "origins">,
  nodeId: string,
): NodeFrame[] {
  return run.origins?.[nodeId]?.frames ?? [{ workflowPath: run.workflowPath, nodeId }]
}

const RANK: Record<NodeStatus, number> = {
  skipped: 0,
  running: 1,
  completed: 2,
  errored: 3,
  paused: 4,
}

/**
 * Each node's status in the file at `path`, from a run of that file or of a
 * workflow that uses it as a sub-workflow. A sub-workflow node shows as
 * running once its Input starts, completed when its Output finishes,
 * skipped when its Input is, and errored when anything inside fails.
 */
export function runStatusesIn(
  run: Pick<RunRecord, "workflowPath" | "origins" | "events" | "pausedFrame">,
  path: string,
): Map<string, NodeStatus> {
  const out = new Map<string, NodeStatus>()
  const put = (id: string, status: NodeStatus, force = false) => {
    const cur = out.get(id)
    // Later events win for a node of this file; a group only moves forward.
    if (force || !cur || RANK[status] >= RANK[cur]) out.set(id, status)
  }
  const apply = (nodeId: string, status: NodeStatus, kind: "event" | "pause") => {
    const frames = framesOf(run, nodeId)
    const role = run.origins?.[nodeId]?.role
    const at = frames.findIndex((f) => samePath(f.workflowPath, path))
    if (at < 0) return
    const last = frames.length - 1
    const here = frames[at] as NodeFrame
    if (at === last) {
      put(here.nodeId, status, kind === "event")
      return
    }
    // A node inside a sub-workflow node of this file.
    if (status === "errored" || status === "paused") return put(here.nodeId, status)
    if (at !== last - 1) {
      if (status === "running") put(here.nodeId, "running")
      return
    }
    if (role === "input" && (status === "running" || status === "skipped")) put(here.nodeId, status)
    else if (role === "output" && status === "completed") put(here.nodeId, "completed")
    else if (status === "running") put(here.nodeId, "running")
  }
  for (const { event } of run.events) {
    if (event.type === "before-node") apply(event.nodeId, "running", "event")
    else if (event.type === "after-node") apply(event.nodeId, "completed", "event")
    else if (event.type === "error") apply(event.nodeId, "errored", "event")
    else if (event.type === "skipped") apply(event.nodeId, "skipped", "event")
  }
  if (run.pausedFrame) apply(run.pausedFrame.nodeId, "paused", "pause")
  return out
}
