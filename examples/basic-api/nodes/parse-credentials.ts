import { defineNode } from "@darrylondil/lorien-runtime";
import { z } from "zod";

export default defineNode({
  name: "Parse Credentials",
  inputs: z.object({ raw: z.unknown() }),
  outputs: z.object({ email: z.string(), password: z.string() }),
  async run({ raw }) {
    const parsed = z
      .object({ email: z.string().email(), password: z.string().min(6) })
      .parse(raw);
    return parsed;
  },
});
