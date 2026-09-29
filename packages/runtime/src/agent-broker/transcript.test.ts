import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  appendChatEvent,
  createChat,
  listChats,
  loadChat,
  TranscriptStore,
} from "./transcript.js"
import type { AgentEvent } from "./types.js"

describe("transcript store", () => {
  let root: string
  let store: TranscriptStore

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lorien-transcript-"))
    store = new TranscriptStore(root)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("createChat writes both the chat file and the index entry", async () => {
    const id = await store.createChat({ agent: "claude", title: "First chat" })
    expect(id).toMatch(/^[a-z0-9-]+$/i)
    const chat = await store.loadChat(id)
    expect(chat?.agent).toBe("claude")
    expect(chat?.title).toBe("First chat")
    expect(chat?.events).toEqual([])
    const idx = await store.listChats()
    expect(idx.chats).toHaveLength(1)
    expect(idx.chats[0]!.id).toBe(id)
  })

  it("appendChatEvent appends and updates lastEventAt in the index", async () => {
    const id = await store.createChat({ agent: "claude", title: "t" })
    const ev: AgentEvent = {
      kind: "user_message",
      text: "hi",
      at: "2026-05-21T00:00:00.000Z",
    }
    await store.appendChatEvent(id, ev)
    const chat = await store.loadChat(id)
    expect(chat?.events).toHaveLength(1)
    expect(chat?.events[0]).toEqual(ev)
    const idx = await store.listChats()
    expect(idx.chats[0]!.lastEventAt).toBe("2026-05-21T00:00:00.000Z")
  })

  it("loadChat returns null when the id is unknown", async () => {
    expect(await store.loadChat("nope")).toBeNull()
  })

  it("listChats sorts by lastEventAt descending", async () => {
    const a = await store.createChat({ agent: "claude", title: "A" })
    const b = await store.createChat({ agent: "claude", title: "B" })
    await store.appendChatEvent(a, {
      kind: "user_message",
      text: "old",
      at: "2026-01-01T00:00:00.000Z",
    })
    await store.appendChatEvent(b, {
      kind: "user_message",
      text: "new",
      at: "2026-05-21T00:00:00.000Z",
    })
    const idx = await store.listChats()
    expect(idx.chats.map((c) => c.id)).toEqual([b, a])
  })

  it("quarantines a corrupted chat file on load and surfaces null", async () => {
    const id = await store.createChat({ agent: "claude", title: "tbd" })
    writeFileSync(
      join(root, ".lorien", "chats", `${id}.json`),
      "{ not valid json",
      "utf-8",
    )
    const result = await store.loadChat(id)
    expect(result).toBeNull()
    // The corrupted file moves to .broken/
    const brokenDir = join(root, ".lorien", "chats", ".broken")
    expect(statSync(brokenDir).isDirectory()).toBe(true)
  })

  it("atomic write — concurrent appends don't lose events", async () => {
    const id = await store.createChat({ agent: "claude", title: "race" })
    const events: AgentEvent[] = Array.from({ length: 25 }, (_, i) => ({
      kind: "user_message",
      text: `msg-${i}`,
      at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    }))
    await Promise.all(events.map((e) => store.appendChatEvent(id, e)))
    const chat = await store.loadChat(id)
    expect(chat?.events).toHaveLength(25)
    // All events present, regardless of order
    const texts = (chat?.events ?? []).map((e) =>
      e.kind === "user_message" ? e.text : "",
    )
    for (let i = 0; i < 25; i++) {
      expect(texts).toContain(`msg-${i}`)
    }
  })

  it("createChat + appendChatEvent are usable via the loose-function API too", async () => {
    const id = await createChat(root, {
      agent: "claude",
      title: "loose",
    })
    await appendChatEvent(root, id, {
      kind: "user_message",
      text: "hi",
      at: "2026-05-21T00:00:00.000Z",
    })
    const chat = await loadChat(root, id)
    expect(chat?.events).toHaveLength(1)
    const idx = await listChats(root)
    expect(idx.chats).toHaveLength(1)
  })
})
