import "dockview-react/dist/styles/dockview.css"
import {
  type DockviewApi,
  DockviewDefaultTab,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react"
import { useCallback } from "react"
import { DebugPanel } from "@/panels/debug-panel"
import { EditorPanel } from "@/panels/editor-panel"
import { FilesPanel } from "@/panels/files-panel"
import { InspectorPanel } from "@/panels/inspector-panel"
import { useDockviewApi } from "@/store/dockview-api"
import { useThemeStore } from "@/store/theme"
import { buildDefaultLayout, loadSavedLayout, saveLayout } from "./default-layout"

const components = {
  files: (_props: IDockviewPanelProps) => <FilesPanel />,
  editor: (_props: IDockviewPanelProps) => <EditorPanel />,
  inspector: (_props: IDockviewPanelProps) => <InspectorPanel />,
  debug: (_props: IDockviewPanelProps) => <DebugPanel />,
}

/**
 * The editor has its own file tab strip, so its dockview header is hidden
 * while it sits alone in its group. If another pane is dragged in, the header
 * comes back so both stay reachable.
 */
function syncEditorHeader(api: DockviewApi): void {
  const group = api.getPanel("editor")?.group
  if (!group) return
  group.header.hidden = group.panels.length === 1
}

// Hide the per-tab X on the outer dockview group tabs — those panels
// (Explorer / Editor / Inspector / Debug) are always-on and re-organizable,
// not closeable. File tabs inside the editor keep their own close UX.
function NoCloseTab(props: IDockviewPanelHeaderProps) {
  return <DockviewDefaultTab {...props} hideClose />
}

export function DockView() {
  const theme = useThemeStore((s) => s.theme)
  const setApi = useDockviewApi((s) => s.setApi)

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const { api } = event
      setApi(api)

      const saved = loadSavedLayout()
      if (saved) {
        try {
          api.fromJSON(saved.state)
        } catch {
          // If the saved state is incompatible with this version, fall back to default
          buildDefaultLayout(api)
        }
      } else {
        buildDefaultLayout(api)
      }

      syncEditorHeader(api)
      api.onDidLayoutChange(() => {
        syncEditorHeader(api)
        saveLayout(api)
      })
    },
    [setApi],
  )

  return (
    <DockviewReact
      onReady={onReady}
      components={components}
      defaultTabComponent={NoCloseTab}
      className={theme === "dark" ? "dockview-theme-dark" : "dockview-theme-light"}
    />
  )
}
