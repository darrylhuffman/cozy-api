import { ConfirmDialogHost } from "@/components/confirm-dialog-host"
import { SettingsDialogHost } from "@/components/settings-dialog"
import { StatusBar } from "@/components/status-bar"
import { Topbar } from "@/components/topbar"
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard"
import { DockView } from "@/layout/dock-view"

export function App() {
  useUnsavedChangesGuard()
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Topbar />
      <div className="flex-1 overflow-hidden">
        <DockView />
      </div>
      <StatusBar />
      <ConfirmDialogHost />
      <SettingsDialogHost />
    </div>
  )
}
