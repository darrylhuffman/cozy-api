import { useEffect, useRef } from "react"
import type {
  ClientMessage,
  ServerMessage,
} from "@darrylondil/lorien-runtime"
import { debugWsUrl } from "../lib/api"
import { useDebugSessionStore } from "../store/debug-session"

interface Singleton {
  ws: WebSocket
  refCount: number
  attempt: number
  closing: boolean
}

let singleton: Singleton | null = null

const BACKOFFS = [1000, 2000, 5000, 10_000]

function connect(inst: Singleton): void {
  const ws = new WebSocket(debugWsUrl())
  inst.ws = ws

  ws.onopen = () => {
    inst.attempt = 0
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
    if (inst.closing) return
    useDebugSessionStore.getState().setConnected(false)
    const wait = BACKOFFS[Math.min(inst.attempt, BACKOFFS.length - 1)]
    inst.attempt += 1
    setTimeout(() => {
      if (inst.closing) return
      // Only reconnect if this instance is still the active singleton (not torn down)
      if (singleton !== inst) return
      connect(inst)
    }, wait)
  }

  ws.onerror = () => {
    try {
      ws.close()
    } catch {
      /* */
    }
  }
}

function ensureConnection(): void {
  if (singleton !== null) return
  const inst: Singleton = {
    ws: null as unknown as WebSocket, // assigned immediately by connect()
    refCount: 0,
    attempt: 0,
    closing: false,
  }
  singleton = inst
  connect(inst)
}

export function useDebugTransport(): {
  send: (msg: ClientMessage) => void
} {
  const sendRef = useRef<(msg: ClientMessage) => void>(() => {})

  useEffect(() => {
    // Hydrate breakpoints from localStorage before first hello
    useDebugSessionStore.getState().hydrateBreakpoints()

    // ensureConnection() is idempotent — creates the singleton only once
    ensureConnection()
    singleton!.refCount += 1

    // sendRef closes over the module-level singleton so it tracks ws replacements
    sendRef.current = (msg) => {
      const s = singleton
      if (!s) return
      if (s.ws.readyState === WebSocket.OPEN) {
        s.ws.send(JSON.stringify(msg))
      }
    }

    return () => {
      const s = singleton
      if (!s) return
      s.refCount = Math.max(0, s.refCount - 1)
      if (s.refCount === 0) {
        s.closing = true
        try {
          s.ws.close()
        } catch {
          /* */
        }
        singleton = null
      }
    }
  }, [])

  return {
    send: (msg) => sendRef.current(msg),
  }
}
