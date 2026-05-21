import { defineNode } from "@darrylondil/lorien-runtime";
import { z } from "zod";

export default defineNode({
  name: "Save User",
  inputs: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
  outputs: z.object({
    user: z.object({ id: z.string(), email: z.string() }),
  }),
  async run({ email, password }, services) {
    void password; // demo only — in production you'd hash and persist this
    const db = (services as {
      db: { createUser(e: string, p: string): Promise<{ id: string; email: string }> };
    }).db;
    const user = await db.createUser(email, password);
    return { user };
  },
});
