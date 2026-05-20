import { Topbar } from "@/components/topbar"
import { DockView } from "@/layout/dock-view"

export function App() {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <Topbar />
      <div className="flex-1 overflow-hidden">
        <DockView />
      </div>
    </div>
  )
}
