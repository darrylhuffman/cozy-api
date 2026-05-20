import { defineNode } from "@darrylondil/lorien-runtime";
import { z } from "zod";

export default defineNode({
  name: "Save User",
  inputs: z.object({ email: z.string(), passwordHash: z.string() }),
  outputs: z.object({
    user: z.object({ id: z.string(), email: z.string() }),
  }),
  async run({ email, passwordHash }, services) {
    void passwordHash; // (not stored; demo)
    const db = (
      services as {
        db: {
          createUser(
            e: string,
            p: string,
          ): Promise<{ id: string; email: string }>;
        };
      }
    ).db;
    const user = await db.createUser(email, passwordHash);
    return { user };
  },
});
