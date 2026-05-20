import "dockview-react/dist/styles/dockview.css"
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react"
import { useCallback } from "react"
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
      className={theme === "dark" ? "dockview-theme-abyss" : "dockview-theme-light"}
    />
  )
}
