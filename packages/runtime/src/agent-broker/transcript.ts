import { randomUUID } from "node:crypto"
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join } from "node:path"
import type {
  AgentEvent,
  AgentName,
  ChatIndex,
  ChatIndexEntry,
  ChatTranscript,
} from "./types.js"

const INDEX_VERSION = 1 as const

interface ChatsLayout {
  chatsDir: string
  brokenDir: string
  indexPath: string
  chatPath: (id: string) => string
}

function layout(projectRoot: string): ChatsLayout {
  const chatsDir = join(projectRoot, ".lorien", "chats")
  return {
    chatsDir,
    brokenDir: join(chatsDir, ".broken"),
    indexPath: join(chatsDir, "index.json"),
    chatPath: (id: string) => join(chatsDir, `${id}.json`),
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const text = await readFile(p, "utf-8")
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

async function writeJsonAtomic(p: string, value: unknown): Promise<void> {
  await mkdir(dirname(p), { recursive: true })
  const tmp = `${p}.tmp-${randomUUID()}`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8")
  await rename(tmp, p)
}

async function loadIndex(l: ChatsLayout): Promise<ChatIndex> {
  const idx = await readJson<ChatIndex>(l.indexPath)
  if (!idx || idx.version !== INDEX_VERSION) {
    return { version: INDEX_VERSION, chats: [] }
  }
  return idx
}

async function saveIndex(l: ChatsLayout, idx: ChatIndex): Promise<void> {
  idx.chats.sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
  await writeJsonAtomic(l.indexPath, idx)
}

/**
 * Process-local serialization queue per chat id. Concurrent calls to
 * appendChatEvent for the same chat are queued so the read-modify-write cycle
 * stays consistent. Cross-process safety is not provided — `lorien dev` is
 * single-process.
 */
const chatQueues = new Map<string, Promise<unknown>>()

function withChatLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prior = chatQueues.get(key) ?? Promise.resolve()
  const next = prior.then(fn, fn)
  chatQueues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

export interface CreateChatInput {
  agent: AgentName
  title: string
}

export async function createChat(
  projectRoot: string,
  input: CreateChatInput,
): Promise<string> {
  const l = layout(projectRoot)
  await mkdir(l.chatsDir, { recursive: true })
  const id = randomUUID()
  const now = new Date().toISOString()
  const transcript: ChatTranscript = {
    id,
    agent: input.agent,
    createdAt: now,
    title: input.title,
    events: [],
  }
  await writeJsonAtomic(l.chatPath(id), transcript)
  await withChatLock(`${projectRoot}::index`, async () => {
    const idx = await loadIndex(l)
    const entry: ChatIndexEntry = {
      id,
      agent: input.agent,
      title: input.title,
      createdAt: now,
      lastEventAt: now,
    }
    idx.chats.push(entry)
    await saveIndex(l, idx)
  })
  return id
}

export async function appendChatEvent(
  projectRoot: string,
  id: string,
  event: AgentEvent,
): Promise<void> {
  const l = layout(projectRoot)
  await withChatLock(`${projectRoot}::${id}`, async () => {
    const chat = await readJson<ChatTranscript>(l.chatPath(id))
    if (!chat) throw new Error(`Chat ${id} not found`)
    chat.events.push(event)
    await writeJsonAtomic(l.chatPath(id), chat)
  })
  await withChatLock(`${projectRoot}::index`, async () => {
    const idx = await loadIndex(l)
    const e = idx.chats.find((c) => c.id === id)
    if (e) {
      e.lastEventAt = event.at
      await saveIndex(l, idx)
    }
  })
}

export async function loadChat(
  projectRoot: string,
  id: string,
): Promise<ChatTranscript | null> {
  const l = layout(projectRoot)
  const path = l.chatPath(id)
  if (!(await exists(path))) return null
  const text = await readFile(path, "utf-8").catch(() => null)
  if (text === null) return null
  try {
    return JSON.parse(text) as ChatTranscript
  } catch {
    await mkdir(l.brokenDir, { recursive: true })
    const stamp = Date.now()
    await rename(path, join(l.brokenDir, `${id}.${stamp}.json`))
    return null
  }
}

export async function listChats(projectRoot: string): Promise<ChatIndex> {
  const l = layout(projectRoot)
  if (!(await exists(l.indexPath))) {
    return { version: INDEX_VERSION, chats: [] }
  }
  const idx = await loadIndex(l)
  // Defensive: drop entries whose files were deleted.
  const entries = await readdir(l.chatsDir).catch(() => [] as string[])
  const present = new Set(
    entries
      .filter((f) => f.endsWith(".json") && f !== "index.json")
      .map((f) => f.slice(0, -".json".length)),
  )
  idx.chats = idx.chats.filter((c) => present.has(c.id))
  return idx
}

/** Convenience class for callers that hold a fixed project root. */
export class TranscriptStore {
  constructor(private readonly projectRoot: string) {}
  createChat(input: CreateChatInput): Promise<string> {
    return createChat(this.projectRoot, input)
  }
  appendChatEvent(id: string, event: AgentEvent): Promise<void> {
    return appendChatEvent(this.projectRoot, id, event)
  }
  loadChat(id: string): Promise<ChatTranscript | null> {
    return loadChat(this.projectRoot, id)
  }
  listChats(): Promise<ChatIndex> {
    return listChats(this.projectRoot)
  }
}
