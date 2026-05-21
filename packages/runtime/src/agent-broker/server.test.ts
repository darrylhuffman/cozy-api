import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AvailabilityProbe } from "./availability.js"
import { mountAgentBroker } from "./server.js"
import { TranscriptStore } from "./transcript.js"

describe("mountAgentBroker — REST", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lorien-broker-rest-"))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it("GET /__lorien/agents/availability returns the probed shape", async () => {
    const app = new Hono()
    const availability = new AvailabilityProbe({
      exec: async () => ({ exitCode: 0, stdout: "v 9.9.9", stderr: "" }),
      now: () => 0,
    })
    mountAgentBroker(app, { projectRoot: root, availability })
    const res = await app.request("/__lorien/agents/availability")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.claude.installed).toBe(true)
    expect(body.codex.installed).toBe(true) // mock exec answers for both
  })

  it("GET /__lorien/agents/chats returns an empty index initially", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const res = await app.request("/__lorien/agents/chats")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.version).toBe(1)
    expect(body.chats).toEqual([])
  })

  it("GET /__lorien/agents/chats/:id returns 404 when missing", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const res = await app.request("/__lorien/agents/chats/nope")
    expect(res.status).toBe(404)
  })

  it("GET /__lorien/agents/chats/:id returns the transcript when present", async () => {
    const app = new Hono()
    mountAgentBroker(app, { projectRoot: root })
    const store = new TranscriptStore(root)
    const id = await store.createChat({ agent: "claude", title: "hi" })
    const res = await app.request(`/__lorien/agents/chats/${id}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe(id)
    expect(body.events).toEqual([])
  })
})
