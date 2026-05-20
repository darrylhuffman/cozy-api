import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Hono } from "hono"
import { startCozyServer } from "@cozy/runtime"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

export async function buildApp(): Promise<Hono> {
  return startCozyServer({ root })
}
