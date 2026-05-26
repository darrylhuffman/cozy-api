import { useDebugTransport } from "@/hooks/use-debug-transport"
import { useDebugSessionStore } from "@/store/debug-session"
import { TriggerSelector } from "./trigger-selector"
import { RequestBuilder } from "./request-builder"
import { HistoryTable } from "./history-table"

export function RunTab() {
  useDebugTransport()
  const connected = useDebugSessionStore((s) => s.connected)
  return (
    <div className="flex h-full flex-col gap-3" data-testid="run-tab">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Send
        </div>
        <div className="text-[10px]">
          <span className={connected ? "text-green-600" : "text-muted-foreground"}>
            {connected ? "● debug connected" : "○ debug disconnected"}
          </span>
        </div>
      </div>
      <TriggerSelector />
      <RequestBuilder />
      <div className="h-px bg-border" />
      <HistoryTable />
    </div>
  )
}
