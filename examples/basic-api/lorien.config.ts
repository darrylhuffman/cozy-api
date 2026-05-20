import { defineConfig } from "@darrylondil/lorien-runtime";

interface User {
  id: string;
  email: string;
}

interface Db {
  createUser(email: string, passwordHash: string): Promise<User>;
}

const inMemoryDb: Db = {
  async createUser(email) {
    return { id: crypto.randomUUID(), email };
  },
};

interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
}

const baseLogger: Logger = {
  info: (msg, fields) => console.log("[info]", msg, fields ?? ""),
};

export default defineConfig({
  target: "hono",
  services: {
    db: inMemoryDb,
    logger: () => baseLogger,
  },
});
