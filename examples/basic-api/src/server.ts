import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { startLorienServer } from "@darrylondil/lorien-runtime";
import type { Hono } from "hono";

const __filename = fileURLToPath(import.meta.url);
const root = join(dirname(__filename), "..");

export async function buildApp(): Promise<Hono> {
  return startLorienServer({ root });
}

function isEntryPoint(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(__filename);
  } catch {
    return false;
  }
}

// `pnpm dev` / `lorien dev` run this file directly; tests import buildApp.
if (isEntryPoint()) {
  const app = await buildApp();
  const port = Number(process.env.PORT) || 3000;
  serve({ fetch: app.fetch, port }, ({ port }) => {
    console.log(`basic-api listening on http://localhost:${port}`);
  });
}
