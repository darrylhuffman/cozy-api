import { describe, expect, it, vi } from "vitest"
import { SubscriberRegistry, type SocketLike } from "./subscribers.js"

function makeSocket(): SocketLike & { messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    send(data: string) {
      messages.push(data)
    },
    isOpen() {
      return true
    },
  }
}

describe("SubscriberRegistry", () => {
  it("subscribe + broadcast sends to all subscribers of a chat", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    const b = makeSocket()
    reg.subscribe("c1", a)
    reg.subscribe("c1", b)
    reg.broadcast("c1", { type: "event", chatId: "c1", event: { kind: "turn_done", turnId: "t", at: "x" } })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(1)
  })

  it("broadcast does NOT send to subscribers of other chats", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    const b = makeSocket()
    reg.subscribe("c1", a)
    reg.subscribe("c2", b)
    reg.broadcast("c1", { type: "chat_created", chatId: "c1" })
    expect(a.messages).toHaveLength(1)
    expect(b.messages).toHaveLength(0)
  })

  it("unsubscribe stops delivery", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    reg.subscribe("c1", a)
    reg.unsubscribe("c1", a)
    reg.broadcast("c1", { type: "chat_created", chatId: "c1" })
    expect(a.messages).toHaveLength(0)
  })

  it("unsubscribe also removes from all other chats (when used at disconnect)", () => {
    const reg = new SubscriberRegistry()
    const a = makeSocket()
    reg.subscribe("c1", a)
    reg.subscribe("c2", a)
    reg.unsubscribeAll(a)
    expect(reg.isAnyOnline("c1")).toBe(false)
    expect(reg.isAnyOnline("c2")).toBe(false)
  })

  it("isAnyOnline returns false when no subscribers and true otherwise", () => {
    const reg = new SubscriberRegistry()
    expect(reg.isAnyOnline("c1")).toBe(false)
    const a = makeSocket()
    reg.subscribe("c1", a)
    expect(reg.isAnyOnline("c1")).toBe(true)
  })

  it("skips sockets where isOpen() returns false", () => {
    const reg = new SubscriberRegistry()
    const closed: SocketLike & { messages: string[] } = {
      messages: [],
      send: vi.fn((d: string) => {
        closed.messages.push(d)
      }),
      isOpen: () => false,
    }
    reg.subscribe("c1", closed)
    reg.broadcast("c1", { type: "chat_created", chatId: "c1" })
    expect(closed.messages).toHaveLength(0)
  })

  it("broadcast continues to other subscribers if one send() throws", () => {
    const reg = new SubscriberRegistry()
    const bad: SocketLike = {
      isOpen: () => true,
      send: () => {
        throw new Error("socket gone")
      },
    }
    const good = makeSocket()
    reg.subscribe("c1", bad)
    reg.subscribe("c1", good)
    expect(() =>
      reg.broadcast("c1", { type: "chat_created", chatId: "c1" }),
    ).not.toThrow()
    expect(good.messages).toHaveLength(1)
  })
})
