import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { startCozyServer } from "@cozy/runtime"
import type { Hono } from "hono"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

export async function buildApp(): Promise<Hono> {
  return startCozyServer({ root })
}
