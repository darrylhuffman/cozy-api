import type { AddPanelOptions, DockviewApi } from "dockview-react"

const STORAGE_KEY = "lorien-ide-layout"

export type PaneId = "files" | "workflow" | "code" | "inspector" | "agents"

export const PANE_IDS = ["files", "workflow", "code", "inspector", "agents"] as const

export const PANE_TITLES: Record<PaneId, string> = {
  files: "Files",
  workflow: "Workflow",
  code: "Code",
  inspector: "Inspector",
  agents: "Agents",
}

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
  api.addPanel({
    id: "agents",
    component: "agents",
    title: "Agents",
    position: { referencePanel: "inspector", direction: "within" },
  })
  // Inspector stays the default-visible tab in its group — dockview otherwise
  // activates the most recently added panel.
  api.getPanel("inspector")?.api.setActive()
}

export { STORAGE_KEY }

/**
 * Reopens a pane that was previously closed by the user.
 *
 * Position is chosen to join an existing tab group when possible:
 * - workflow/code prefer to dock `within` each other (single shared tab strip),
 *   falling back to sitting beside Files or Inspector.
 * - files docks to the left of any existing pane.
 * - inspector docks to the right of any existing pane.
 *
 * If no other panes exist, the panel is added fresh and dockview places it.
 */
export function reopenPanel(api: DockviewApi, id: PaneId): void {
  if (api.getPanel(id)) return

  const options: AddPanelOptions = {
    id,
    component: id,
    title: PANE_TITLES[id],
  }

  if (id === "files") {
    const ref = api.getPanel("workflow") ?? api.getPanel("code") ?? api.getPanel("inspector")
    if (ref) options.position = { referencePanel: ref.id, direction: "left" }
    options.initialWidth = 250
  } else if (id === "inspector") {
    const ref = api.getPanel("code") ?? api.getPanel("workflow") ?? api.getPanel("files")
    if (ref) options.position = { referencePanel: ref.id, direction: "right" }
    options.initialWidth = 400
  } else if (id === "agents") {
    // Prefer joining Inspector's group; fall back to a new pane on the right.
    const inspector = api.getPanel("inspector")
    if (inspector) {
      options.position = { referencePanel: inspector.id, direction: "within" }
    } else {
      const ref = api.getPanel("code") ?? api.getPanel("workflow") ?? api.getPanel("files")
      if (ref) options.position = { referencePanel: ref.id, direction: "right" }
      options.initialWidth = 400
    }
  } else {
    // workflow or code — prefer joining the sibling editor group
    const sibling: PaneId = id === "workflow" ? "code" : "workflow"
    const siblingPanel = api.getPanel(sibling)
    if (siblingPanel) {
      options.position = { referencePanel: siblingPanel.id, direction: "within" }
    } else if (api.getPanel("files")) {
      options.position = { referencePanel: "files", direction: "right" }
    } else if (api.getPanel("inspector")) {
      options.position = { referencePanel: "inspector", direction: "left" }
    }
  }

  api.addPanel(options)
  api.getPanel(id)?.api.setActive()
}
