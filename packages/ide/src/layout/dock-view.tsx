import "dockview-react/dist/styles/dockview.css"
import {
  DockviewDefaultTab,
  DockviewReact,
  type DockviewReadyEvent,
  type IDockviewPanelHeaderProps,
  type IDockviewPanelProps,
} from "dockview-react"
import { useCallback } from "react"
import { AgentsPanel } from "@/panels/agents/agents-panel"
import { CodeEditorPanel } from "@/panels/code-editor-panel"
import { FilesPanel } from "@/panels/files-panel"
import { InspectorPanel } from "@/panels/inspector-panel"
import { WorkflowEditorPanel } from "@/panels/workflow-editor-panel"
import { useDockviewApi } from "@/store/dockview-api"
import { useThemeStore } from "@/store/theme"
import { buildDefaultLayout, loadSavedLayout, saveLayout } from "./default-layout"

const components = {
  files: (_props: IDockviewPanelProps) => <FilesPanel />,
  workflow: (_props: IDockviewPanelProps) => <WorkflowEditorPanel />,
  code: (_props: IDockviewPanelProps) => <CodeEditorPanel />,
  inspector: (_props: IDockviewPanelProps) => <InspectorPanel />,
  agents: (_props: IDockviewPanelProps) => <AgentsPanel />,
}

// Hide the per-tab X on the outer dockview group tabs — those panels
// (Files / Workflow / Code / Inspector) are always-on and re-organizable,
// not closeable. Sub-tabs inside Workflow/Code panels keep their own close UX.
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

      api.onDidLayoutChange(() => {
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
