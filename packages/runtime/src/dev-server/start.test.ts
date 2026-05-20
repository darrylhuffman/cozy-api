import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineNode } from "../define-node.js";
import { startLorienServer } from "./start.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(__dirname, "__fixtures__", "basic");

describe("startLorienServer", () => {
  it("loads lorien.config.ts and mounts workflows", async () => {
    const app = await startLorienServer({ root: fixtureRoot });
    const res = await app.request("/hello");
    expect(res.status).toBe(200);
    expect(await res.json()).toBe("hello from fixture");
  });

  it("warns but does not throw when lorien.config.ts is missing", async () => {
    // Use a temp root without a config; expect successful return with empty services
    const tmpRoot = join(__dirname, "__fixtures__"); // exists but no lorien.config.ts directly here
    const app = await startLorienServer({ root: tmpRoot, lenient: true });
    expect(app).toBeDefined();
  });

  // TODO: strict-mode (lenient:false) tests will be added with the next round of fixture work.
});

describe("startLorienServer overrides", () => {
  it("service overrides replace the value from lorien.config.ts", async () => {
    // Baseline: fixture's db.ping returns "pong"
    const app1 = await startLorienServer({ root: fixtureRoot });
    const res1 = await app1.request("/ping");
    expect(await res1.json()).toBe("pong");

    // Overridden: provide a different db
    const app2 = await startLorienServer({
      root: fixtureRoot,
      services: { db: { ping: () => "overridden" } as never },
    });
    const res2 = await app2.request("/ping");
    expect(await res2.json()).toBe("overridden");
  });

  it("node overrides replace the auto-imported node", async () => {
    // Define an override that returns a different greeting
    const customSayHello = defineNode({
      inputs: z.object({}),
      outputs: z.object({ greeting: z.string() }),
      async run() {
        return { greeting: "OVERRIDDEN" };
      },
    });
    const app = await startLorienServer({
      root: fixtureRoot,
      nodes: { "./nodes/say-hello": customSayHello },
    });
    const res = await app.request("/hello");
    expect(await res.json()).toBe("OVERRIDDEN");
  });
});
