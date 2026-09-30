import type { AddPanelOptions, DockviewApi } from "dockview-react"

const STORAGE_KEY = "lorien-ide-layout"

/** Bumped when the set of panes changes; older saved layouts reset to default. */
const LAYOUT_VERSION = 3

export type PaneId = "files" | "git" | "editor" | "inspector" | "debug" | "agents"

export const PANE_IDS = ["files", "git", "editor", "inspector", "debug", "agents"] as const

export const PANE_TITLES: Record<PaneId, string> = {
  files: "Explorer",
  git: "Source Control",
  editor: "Editor",
  inspector: "Inspector",
  debug: "Debug",
  agents: "Agents",
}

export interface SavedLayout {
  version: typeof LAYOUT_VERSION
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
    if (parsed.version !== LAYOUT_VERSION || !parsed.state) return null
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
    const payload: SavedLayout = { version: LAYOUT_VERSION, state: api.toJSON() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage may be unavailable in some browsers (private mode, quota)
    // — swallow rather than crash the app
  }
}

/**
 * Builds the default layout.
 *
 * Explorer: left column, with Source Control as a second tab
 * Editor:   centre (workflows and code share one tab strip)
 * Debug:    under the editor
 * Inspector: right column (Inspect · Tests · Run)
 *
 * Agents is its own pane, closed until the top-bar button or an "Ask AI"
 * action opens it between the editor and the Inspector.
 */
export function buildDefaultLayout(api: DockviewApi): void {
  api.addPanel({
    id: "files",
    component: "files",
    title: PANE_TITLES.files,
    initialWidth: FILES_WIDTH,
  })
  api.addPanel({
    id: "editor",
    component: "editor",
    title: PANE_TITLES.editor,
    position: { referencePanel: "files", direction: "right" },
  })
  api.addPanel({
    id: "git",
    component: "git",
    title: PANE_TITLES.git,
    position: { referencePanel: "files", direction: "within" },
    inactive: true,
  })
  api.addPanel({
    id: "inspector",
    component: "inspector",
    title: PANE_TITLES.inspector,
    position: { referencePanel: "editor", direction: "right" },
    initialWidth: INSPECTOR_WIDTH,
  })
  api.addPanel({
    id: "debug",
    component: "debug",
    title: PANE_TITLES.debug,
    position: { referencePanel: "editor", direction: "below" },
    initialHeight: DEBUG_HEIGHT,
  })
  // dockview only honours initial sizes for the first split, so pin the side
  // columns and the bottom panel explicitly; the editor takes what is left.
  api.getPanel("files")?.api.setSize({ width: FILES_WIDTH })
  api.getPanel("inspector")?.api.setSize({ width: INSPECTOR_WIDTH })
  api.getPanel("debug")?.api.setSize({ height: DEBUG_HEIGHT })
  api.getPanel("editor")?.api.setActive()
}

export const FILES_WIDTH = 248
export const INSPECTOR_WIDTH = 380
export const DEBUG_HEIGHT = 240
export const AGENTS_WIDTH = 380

export { STORAGE_KEY }

/**
 * Reopens a pane that was previously closed by the user, next to the panes
 * that are still open.
 */
export function reopenPanel(api: DockviewApi, id: PaneId): void {
  if (api.getPanel(id)) return

  const options: AddPanelOptions = {
    id,
    component: id,
    title: PANE_TITLES[id],
  }

  if (id === "files") {
    const git = api.getPanel("git")
    const ref = api.getPanel("editor") ?? api.getPanel("debug") ?? api.getPanel("inspector")
    if (git) options.position = { referencePanel: git.id, direction: "within" }
    else if (ref) options.position = { referencePanel: ref.id, direction: "left" }
    options.initialWidth = FILES_WIDTH
  } else if (id === "git") {
    // A tab beside the Explorer, else its own column on the left.
    const files = api.getPanel("files")
    const ref = api.getPanel("editor") ?? api.getPanel("debug") ?? api.getPanel("inspector")
    if (files) options.position = { referencePanel: files.id, direction: "within" }
    else if (ref) options.position = { referencePanel: ref.id, direction: "left" }
    options.initialWidth = FILES_WIDTH
  } else if (id === "inspector") {
    const ref = api.getPanel("editor") ?? api.getPanel("debug") ?? api.getPanel("files")
    if (ref) options.position = { referencePanel: ref.id, direction: "right" }
    options.initialWidth = INSPECTOR_WIDTH
  } else if (id === "agents") {
    // Between the editor and the Inspector, so the space comes out of the editor.
    const editor = api.getPanel("editor")
    const inspector = api.getPanel("inspector")
    if (editor) options.position = { referencePanel: editor.id, direction: "right" }
    else if (inspector) options.position = { referencePanel: inspector.id, direction: "left" }
    options.initialWidth = AGENTS_WIDTH
  } else if (id === "debug") {
    const ref = api.getPanel("editor") ?? api.getPanel("files") ?? api.getPanel("inspector")
    if (ref) options.position = { referencePanel: ref.id, direction: "below" }
    options.initialHeight = DEBUG_HEIGHT
  } else {
    // editor
    if (api.getPanel("debug")) options.position = { referencePanel: "debug", direction: "above" }
    else if (api.getPanel("files"))
      options.position = { referencePanel: "files", direction: "right" }
    else if (api.getPanel("inspector"))
      options.position = { referencePanel: "inspector", direction: "left" }
  }

  api.addPanel(options)
  const panel = api.getPanel(id)
  // dockview ignores initialWidth when splitting an existing column.
  if (panel && options.initialWidth) panel.api.setSize({ width: options.initialWidth })
  if (id === "agents") api.getPanel("inspector")?.api.setSize({ width: INSPECTOR_WIDTH })
  panel?.api.setActive()
}

/** Opens (or focuses) a pane. */
export function showPanel(api: DockviewApi, id: PaneId): void {
  const panel = api.getPanel(id)
  if (panel) panel.api.setActive()
  else reopenPanel(api, id)
}
