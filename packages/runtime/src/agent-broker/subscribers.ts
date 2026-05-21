import type { ServerMsg } from "./types.js"

/** Minimal interface over `ws` WebSocket — kept narrow for testability. */
export interface SocketLike {
  send(data: string): void
  isOpen(): boolean
}

export class SubscriberRegistry {
  private readonly perChat = new Map<string, Set<SocketLike>>()

  subscribe(chatId: string, sock: SocketLike): void {
    let set = this.perChat.get(chatId)
    if (!set) {
      set = new Set()
      this.perChat.set(chatId, set)
    }
    set.add(sock)
  }

  unsubscribe(chatId: string, sock: SocketLike): void {
    const set = this.perChat.get(chatId)
    if (!set) return
    set.delete(sock)
    if (set.size === 0) this.perChat.delete(chatId)
  }

  /** Remove a socket from every chat it was subscribed to (e.g. on disconnect). */
  unsubscribeAll(sock: SocketLike): void {
    for (const [id, set] of this.perChat) {
      set.delete(sock)
      if (set.size === 0) this.perChat.delete(id)
    }
  }

  isAnyOnline(chatId: string): boolean {
    const set = this.perChat.get(chatId)
    if (!set) return false
    for (const s of set) if (s.isOpen()) return true
    return false
  }

  broadcast(chatId: string, msg: ServerMsg): void {
    const set = this.perChat.get(chatId)
    if (!set) return
    const payload = JSON.stringify(msg)
    for (const s of set) {
      if (s.isOpen()) s.send(payload)
    }
  }
}
