import { defineConfig } from "@darrylondil/lorien-runtime"
import { defaultDbFile, openPetStoreDb } from "./src/db.js"

interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
}

const baseLogger: Logger = {
  info: (msg, fields) => console.log("[info]", msg, fields ?? ""),
}

export default defineConfig({
  target: "hono",
  services: {
    // SQLite via Node's built-in node:sqlite. Set PETSTORE_DB=:memory: for a throwaway database.
    db: openPetStoreDb(defaultDbFile()),
    logger: () => baseLogger,
  },
})
