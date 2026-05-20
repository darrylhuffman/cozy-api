import { defineConfig } from "../../../index.js"

interface FakeDb {
  ping(): string
}

const db: FakeDb = { ping: () => "pong" }

export default defineConfig({
  target: "hono",
  services: {
    db,
  },
})
