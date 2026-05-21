import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffold } from "./scaffold.js";

describe("scaffold", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-scaffold-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes all expected files to the target directory", async () => {
    const target = join(dir, "my-app");
    await scaffold({ target, name: "my-app", pm: "pnpm" });

    const expected = [
      ".gitignore",
      "package.json",
      "tsconfig.json",
      "biome.json",
      "lorien.config.ts",
      "workflows/hello.workflow",
      "nodes/say-hello.ts",
      "src/server.ts",
      "AGENTS.md",
      ".claude/skills/lorien-api/SKILL.md",
      "README.md",
    ];
    for (const f of expected) {
      const stat = statSync(join(target, f));
      expect(stat.isFile()).toBe(true);
    }
  });

  it("package.json has the project name", async () => {
    const target = join(dir, "another-app");
    await scaffold({ target, name: "another-app", pm: "npm" });
    const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf-8"));
    expect(pkg.name).toBe("another-app");
  });

  it("README uses the chosen package manager", async () => {
    const target = join(dir, "yarn-app");
    await scaffold({ target, name: "yarn-app", pm: "yarn" });
    const readme = readFileSync(join(target, "README.md"), "utf-8");
    expect(readme).toMatch(/yarn dev/);
  });

  it("writes a Claude Code skill file with frontmatter under .claude/skills/lorien-api", async () => {
    const target = join(dir, "skill-app");
    await scaffold({ target, name: "skill-app", pm: "pnpm" });
    const skill = readFileSync(
      join(target, ".claude/skills/lorien-api/SKILL.md"),
      "utf-8",
    );
    expect(skill.startsWith("---\nname: lorien-api\n")).toBe(true);
    expect(skill).toMatch(/# lorien-api project guide/);
    expect(skill).toMatch(/<!-- lorien-skill-version: 1 -->/);
  });

  it("writes AGENTS.md without frontmatter (just the canonical body)", async () => {
    const target = join(dir, "agents-app");
    await scaffold({ target, name: "agents-app", pm: "pnpm" });
    const agents = readFileSync(join(target, "AGENTS.md"), "utf-8");
    expect(agents.startsWith("---")).toBe(false);
    expect(agents).toMatch(/# lorien-api project guide/);
    expect(agents).toMatch(/<!-- lorien-skill-version: 1 -->/);
  });
});
