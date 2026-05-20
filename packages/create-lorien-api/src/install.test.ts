import { describe, expect, it } from "vitest";
import { installCommand } from "./install.js";

describe("installCommand", () => {
  it("returns 'npm install' for npm", () => {
    expect(installCommand("npm")).toEqual({ cmd: "npm", args: ["install"] });
  });

  it("returns 'pnpm install' for pnpm", () => {
    expect(installCommand("pnpm")).toEqual({ cmd: "pnpm", args: ["install"] });
  });

  it("returns 'yarn install' for yarn", () => {
    expect(installCommand("yarn")).toEqual({ cmd: "yarn", args: ["install"] });
  });

  it("returns 'bun install' for bun", () => {
    expect(installCommand("bun")).toEqual({ cmd: "bun", args: ["install"] });
  });
});

// runInstall is intentionally not unit-tested here — it spawns a real process.
// Integration would require a clean test directory and a real package manager.
// The full create-lorien-api command will be smoke-tested manually.
