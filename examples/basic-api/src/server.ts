import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startLorienServer } from "@darrylondil/lorien-runtime";
import type { Hono } from "hono";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

export async function buildApp(): Promise<Hono> {
  return startLorienServer({ root });
}
