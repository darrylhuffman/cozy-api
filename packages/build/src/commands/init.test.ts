import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "./init.js";

describe("runInit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lorien-init-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes AGENTS.md when none exists", async () => {
    const result = await runInit({ root: dir, force: false });
    expect(result.ok).toBe(true);
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(content).toMatch(/lorien/);
    expect(content).toMatch(/defineNode/);
  });

  it("refuses to overwrite when AGENTS.md exists without --force", async () => {
    writeFileSync(join(dir, "AGENTS.md"), "PRE-EXISTING");
    const result = await runInit({ root: dir, force: false });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("exists");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe("PRE-EXISTING");
  });

  it("overwrites with --force", async () => {
    writeFileSync(join(dir, "AGENTS.md"), "PRE-EXISTING");
    const result = await runInit({ root: dir, force: true });
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).not.toBe(
      "PRE-EXISTING",
    );
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toMatch(/lorien/);
  });

  it("uses the directory basename as the project name", async () => {
    // dir is /tmp/lorien-init-xxxxxx — basename starts with lorien-init-
    await runInit({ root: dir, force: false });
    const content = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    const basename = dir.split(/[\\/]/).pop()!;
    expect(content).toMatch(new RegExp(`# AI agent guide for ${basename}`));
  });
});
