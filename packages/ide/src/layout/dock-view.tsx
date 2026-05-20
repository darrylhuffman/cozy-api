import "dockview-react/dist/styles/dockview.css"
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react"
import { useCallback } from "react"
import { EditorPanel } from "@/panels/editor-panel"
import { FilesPanel } from "@/panels/files-panel"
import { InspectorPanel } from "@/panels/inspector-panel"
import { buildDefaultLayout, loadSavedLayout, saveLayout } from "./default-layout"

const components = {
  files: (_props: IDockviewPanelProps) => <FilesPanel />,
  editor: (_props: IDockviewPanelProps) => <EditorPanel />,
  inspector: (_props: IDockviewPanelProps) => <InspectorPanel />,
}

export function DockView() {
  const onReady = useCallback((event: DockviewReadyEvent) => {
    const { api } = event
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
  }, [])

  return (
    <DockviewReact onReady={onReady} components={components} className="dockview-theme-abyss" />
  )
}
