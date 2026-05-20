import { describe, expect, it } from "vitest";
import { emitIndex, slugIdentifier, slugifyPath } from "./emit-index.js";

describe("slugIdentifier", () => {
  it("converts simple paths to underscore-joined identifiers", () => {
    expect(slugIdentifier("users/create")).toBe("users_create");
  });

  it("drops square brackets from dynamic-route segments", () => {
    expect(slugIdentifier("users/[id]/get")).toBe("users_id_get");
  });

  it("collapses runs of underscores and replaces unsafe characters", () => {
    expect(slugIdentifier("v1/users.list")).toBe("v1_users_list");
  });

  it("prefixes a leading-digit result with `_`", () => {
    expect(slugIdentifier("404/handler")).toBe("_404_handler");
  });

  it("returns `workflow` for empty / all-unsafe input", () => {
    expect(slugIdentifier("")).toBe("workflow");
  });
});

describe("slugifyPath", () => {
  it("rewrites bracket segments to underscore-wrapped form for filesystem safety", () => {
    expect(slugifyPath("users/[id]/get")).toBe("users/_id_/get");
  });

  it("leaves plain paths untouched", () => {
    expect(slugifyPath("users/create")).toBe("users/create");
  });
});

describe("emitIndex", () => {
  it("emits an empty boot file with no register calls when no workflows", () => {
    const { source } = emitIndex({ workflowPaths: [] });
    expect(source).toMatch(/import \{ Hono \} from "hono"/);
    expect(source).toMatch(/import \{ serve \} from "@hono\/node-server"/);
    expect(source).toMatch(/const app = new Hono\(\)/);
    expect(source).toMatch(/serve\(\{ fetch: app\.fetch, port \}/);
    expect(source).not.toMatch(/register_/);
  });

  it("imports and calls a single workflow's register function", () => {
    const { source } = emitIndex({ workflowPaths: ["users/create"] });
    expect(source).toMatch(
      /import \{ register as register_users_create \} from "\.\/workflows\/users\/create\.gen\.js"/,
    );
    expect(source).toMatch(/register_users_create\(app\)/);
  });

  it("imports and calls multiple workflow register functions in sorted order", () => {
    const { source } = emitIndex({
      workflowPaths: ["users/create", "items/list", "users/[id]/get"],
    });
    // Expect sorted order: items/list, users/[id]/get, users/create.
    const importLines = source
      .split("\n")
      .filter((l) => l.startsWith("import { register"));
    expect(importLines).toHaveLength(3);
    expect(importLines[0]).toContain("./workflows/items/list.gen.js");
    expect(importLines[1]).toContain("./workflows/users/_id_/get.gen.js");
    expect(importLines[2]).toContain("./workflows/users/create.gen.js");

    expect(source).toMatch(/register_items_list\(app\)/);
    expect(source).toMatch(/register_users_id_get\(app\)/);
    expect(source).toMatch(/register_users_create\(app\)/);
  });

  it("starts the server with PORT env var (default 3000) and logs the bound port", () => {
    const { source } = emitIndex({ workflowPaths: [] });
    expect(source).toMatch(/Number\(process\.env\.PORT\) \|\| 3000/);
    expect(source).toMatch(
      /lorien listening on http:\/\/localhost:\$\{port\}/,
    );
  });

  it("rewrites dynamic-segment workflow paths in both import paths and identifiers", () => {
    const { source } = emitIndex({ workflowPaths: ["users/[id]/get"] });
    expect(source).toMatch(/import \{ register as register_users_id_get \}/);
    expect(source).toMatch(/from "\.\/workflows\/users\/_id_\/get\.gen\.js"/);
  });
});
