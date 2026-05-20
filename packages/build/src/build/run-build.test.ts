import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runBuild } from "./run-build.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use the runtime's fixture (basic-api has too much; runtime fixture is minimal)
const fixtureRoot = join(
  __dirname,
  "..",
  "..",
  "..",
  "runtime",
  "src",
  "dev-server",
  "__fixtures__",
  "basic",
);

describe("runBuild (integration)", () => {
  it("builds the runtime fixture: writes dist/workflows + dist/index.ts", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lorien-build-"));
    try {
      const result = await runBuild({
        root: fixtureRoot,
        outDir: tmp,
        skipTypes: true, // fixture's lorien.config writes to its own .lorien/ — skip in tests
      });
      expect(result.ok).toBe(true);
      expect(result.workflowsBuilt).toBeGreaterThan(0);
      expect(existsSync(join(tmp, "index.ts"))).toBe(true);
      // hello.workflow -> workflows/hello.gen.ts
      expect(existsSync(join(tmp, "workflows", "hello.gen.ts"))).toBe(true);
      const helloGen = readFileSync(
        join(tmp, "workflows", "hello.gen.ts"),
        "utf-8",
      );
      expect(helloGen).toMatch(/AUTO-GENERATED/);
      expect(helloGen).toMatch(/export function register/);
      expect(helloGen).toMatch(/say-hello/); // the user node is imported
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cleans existing outDir before building", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "lorien-build-"));
    try {
      // Pre-populate
      const fs = await import("node:fs/promises");
      await fs.writeFile(join(tmp, "STALE_FILE.txt"), "should be removed");

      await runBuild({ root: fixtureRoot, outDir: tmp, skipTypes: true });
      expect(existsSync(join(tmp, "STALE_FILE.txt"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
