import { join } from "node:path"
import { defineProvider } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import { openPetStoreDb } from "./db/open.js"

/**
 * The pet store's SQLite database (Node's built-in node:sqlite), opened once
 * at boot and shared by every request. Set PETSTORE_DB=:memory: for a
 * throwaway database.
 */
export default defineProvider({
  selector: "db",
  color: "sky",
  env: z.object({
    PETSTORE_DB: z.string().default(join(import.meta.dirname, "..", "data", "petstore.db")),
  }),
  create: ({ env }) => openPetStoreDb(env.PETSTORE_DB),
  dispose: (db) => db.close(),
})
