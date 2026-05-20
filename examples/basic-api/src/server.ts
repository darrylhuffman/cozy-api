import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { loadWorkspace, mountWorkflows } from "@cozy/runtime"
import { Hono } from "hono"
import config from "../cozy.config.js"
import parseCredentials from "../nodes/parse-credentials.js"
import saveUser from "../nodes/save-user.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

export async function buildApp(): Promise<Hono> {
  const ws = await loadWorkspace(root)
  if (ws.errors.length > 0) {
    for (const e of ws.errors) console.error(e.path, e.message)
  }
  const app = new Hono()
  const services: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(config.services)) {
    services[name] = typeof value === "function" ? value({ requestId: "boot", timestamp: 0 }) : value
  }
  mountWorkflows(app, ws.workflows, {
    nodes: {
      "./nodes/parse-credentials": parseCredentials,
      "./nodes/save-user": saveUser,
    },
    services,
  })
  return app
}
