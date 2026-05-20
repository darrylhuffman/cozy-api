import type { DockviewApi } from "dockview-react"

const STORAGE_KEY = "lorien-ide-layout"

export interface SavedLayout {
  version: 1
  state: ReturnType<DockviewApi["toJSON"]>
}

/**
 * Loads a saved layout from localStorage if one exists.
 * Returns null if absent or malformed.
 */
export function loadSavedLayout(): SavedLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedLayout
    if (parsed.version !== 1 || !parsed.state) return null
    return parsed
  } catch {
    return null
  }
}

/**
 * Saves the current layout to localStorage.
 */
export function saveLayout(api: DockviewApi): void {
  try {
    const payload: SavedLayout = { version: 1, state: api.toJSON() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage may be unavailable in some browsers (private mode, quota)
    // — swallow rather than crash the app
  }
}

/**
 * Builds the default Layout B arrangement.
 *
 * Files sidebar: 250 px (left)
 * Inspector:     400 px (right)
 * Workflow/Code: remaining space (centre, same dockview group — top-tabs)
 */
export function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({
    id: "files",
    component: "files",
    title: "Files",
    initialWidth: 250,
  })
  api.addPanel({
    id: "workflow",
    component: "workflow",
    title: "Workflow",
    position: { referencePanel: "files", direction: "right" },
  })
  api.addPanel({
    id: "code",
    component: "code",
    title: "Code",
    // "within" places this panel in the same group as "workflow",
    // giving dockview's native "Workflow | Code" tab strip at the top.
    position: { referencePanel: "workflow", direction: "within" },
  })
  api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { referencePanel: "code", direction: "right" },
    initialWidth: 400,
  })
}

export { STORAGE_KEY }
