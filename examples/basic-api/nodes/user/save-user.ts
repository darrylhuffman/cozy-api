import { defineNode } from "@darrylondil/lorien-runtime";
import { z } from "zod";

export default defineNode({
  name: "Save User",
  color: "yellow",
  inputs: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
  outputs: z.object({
    user: z.object({ id: z.string(), email: z.string() }),
  }),
  /**
   * Creates a demo user record from the validated workflow inputs.
   *
   * @param input - The email and plain-text password supplied by the workflow.
   * @returns The created user object exposed on the node's `user` output.
   *
   * @remarks
   * This example intentionally passes the password through unchanged to keep the
   * sample focused on node/service wiring. Production code should hash the
   * password before persistence.
   */
  async run({ email, password }, services) {
    void password; // demo only — in production you'd hash and persist this
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
    const user = await db.createUser(email, password);
    return { user };
  },
});
