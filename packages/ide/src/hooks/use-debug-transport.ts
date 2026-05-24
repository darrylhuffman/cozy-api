import { useEffect, useRef } from "react"
import type {
  ClientMessage,
  ServerMessage,
} from "@darrylondil/lorien-runtime"
import { debugWsUrl } from "../lib/api"
import { useDebugSessionStore } from "../store/debug-session"

let singleton: { ws: WebSocket; refCount: number } | null = null

const BACKOFFS = [1000, 2000, 5000, 10_000]

export function useDebugTransport(): {
  send: (msg: ClientMessage) => void
} {
  const sendRef = useRef<(msg: ClientMessage) => void>(() => {})

  useEffect(() => {
    let cancelled = false
    let attempt = 0

    const connect = () => {
      const ws = new WebSocket(debugWsUrl())
      singleton = { ws, refCount: (singleton?.refCount ?? 0) + 1 }

      ws.onopen = () => {
        attempt = 0
        const bps = useDebugSessionStore.getState().breakpoints
        ws.send(JSON.stringify({ type: "hello", breakpoints: bps } satisfies ClientMessage))
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as ServerMessage
          useDebugSessionStore.getState().applyMessage(msg)
        } catch {
          /* swallow malformed payload */
        }
      }
      ws.onclose = () => {
        if (cancelled) return
        useDebugSessionStore.getState().setConnected(false)
        const wait = BACKOFFS[Math.min(attempt, BACKOFFS.length - 1)]
        attempt++
        setTimeout(connect, wait)
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* */
        }
      }

      sendRef.current = (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
      }
    }

    // Hydrate breakpoints from localStorage before first hello
    useDebugSessionStore.getState().hydrateBreakpoints()
    connect()

    return () => {
      cancelled = true
      if (singleton) {
        singleton.refCount = Math.max(0, singleton.refCount - 1)
        if (singleton.refCount === 0) {
          try {
            singleton.ws.close()
          } catch {
            /* */
          }
          singleton = null
        }
      }
    }
  }, [])

  return {
    send: (msg) => sendRef.current(msg),
  }
}
