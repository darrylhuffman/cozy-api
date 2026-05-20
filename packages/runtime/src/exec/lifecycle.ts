export type LifecycleEvent =
  | { type: "before-node"; nodeId: string; input: Record<string, unknown> }
  | { type: "after-node"; nodeId: string; output: Record<string, unknown>; durationMs: number }
  | { type: "edge-fired"; from: string; to: string; value: unknown }
  | { type: "error"; nodeId: string; error: Error }
  | { type: "complete"; totalMs: number }

export type LifecycleEventType = LifecycleEvent["type"]

type Handler<T extends LifecycleEventType> = (ev: Extract<LifecycleEvent, { type: T }>) => void

export class LifecycleEmitter {
  private handlers = new Map<LifecycleEventType, Set<Handler<LifecycleEventType>>>()

  on<T extends LifecycleEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as unknown as Handler<LifecycleEventType>)
    return () => set?.delete(handler as unknown as Handler<LifecycleEventType>)
  }

  emit(event: LifecycleEvent): void {
    const set = this.handlers.get(event.type)
    if (!set) return
    for (const handler of set) {
      try {
        handler(event as Parameters<typeof handler>[0])
      } catch {
        // Subscribers must not break other subscribers or the workflow.
      }
    }
  }
}
