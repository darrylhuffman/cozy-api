export type FileEvent = { type: "change" | "add" | "unlink"; path: string }

type Listener = (event: FileEvent) => void

let source: EventSource | null = null
const listeners = new Set<Listener>()

function ensureConnected(): void {
  if (source) return
  source = new EventSource("/api/events")
  const dispatch = (type: FileEvent["type"]) => (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data as string) as { path: string }
      const event: FileEvent = { type, path: data.path }
      for (const l of listeners) l(event)
    } catch {
      // ignore malformed events
    }
  }
  source.addEventListener("change", dispatch("change") as EventListenerOrEventListenerObject)
  source.addEventListener("add", dispatch("add") as EventListenerOrEventListenerObject)
  source.addEventListener("unlink", dispatch("unlink") as EventListenerOrEventListenerObject)
  source.addEventListener("error", () => {
    // EventSource auto-reconnects; just log
    console.warn("/api/events disconnected; will reconnect")
  })
}

export function subscribeToFileEvents(listener: Listener): () => void {
  ensureConnected()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
