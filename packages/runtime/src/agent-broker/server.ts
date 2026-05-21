import type { Hono } from "hono"
import { AvailabilityProbe } from "./availability.js"
import { listChats, loadChat } from "./transcript.js"

export interface MountAgentBrokerOptions {
  projectRoot: string
  /** Inject a custom probe in tests; defaults to the real one. */
  availability?: AvailabilityProbe
}

export function mountAgentBroker(
  app: Hono,
  opts: MountAgentBrokerOptions,
): void {
  const availability = opts.availability ?? new AvailabilityProbe()

  app.get("/__lorien/agents/availability", async (c) => {
    const r = await availability.probe()
    return c.json(r)
  })

  app.get("/__lorien/agents/chats", async (c) => {
    const idx = await listChats(opts.projectRoot)
    return c.json(idx)
  })

  app.get("/__lorien/agents/chats/:id", async (c) => {
    const id = c.req.param("id")
    const chat = await loadChat(opts.projectRoot, id)
    if (!chat) return c.json({ error: "not found" }, 404)
    return c.json(chat)
  })
}
