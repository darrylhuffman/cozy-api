import type { Breakpoint } from "@darrylondil/lorien-runtime"

export const STORAGE_KEY = "lorien-debug-breakpoints"

export function loadBreakpoints(): Breakpoint[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (b): b is Breakpoint =>
        b != null &&
        typeof b === "object" &&
        typeof (b as Breakpoint).workflowPath === "string" &&
        typeof (b as Breakpoint).nodeId === "string" &&
        typeof (b as Breakpoint).kind === "string",
    )
  } catch {
    return []
  }
}

export function saveBreakpoints(bps: Breakpoint[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bps))
  } catch {
    /* private-mode / quota — swallow */
  }
}
