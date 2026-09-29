# IDE AI Agent — Plan A: Skill Artifact

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the AI-agent project guide (canonical body) as two files in every new lorien project: `.claude/skills/lorien-api/SKILL.md` (with Claude Code frontmatter) and `AGENTS.md` (no frontmatter), via `create-lorien-api`.

**Architecture:** Single canonical skill body string lives in `packages/create-lorien-api/src/templates.ts`. Two renderers (`renderAgentsMd`, `renderClaudeSkill`) wrap it. `scaffold.ts` writes both files during project creation. No runtime-side surface in Plan A — the spec's "canonical content in `@darrylondil/lorien-runtime`" is deferred to Plan B (broker) where the runtime gains another consumer; Plan B will refactor `create-lorien-api` to import from runtime. For Plan A, `create-lorien-api` owns the strings to keep its npx footprint small (no runtime peer dep).

**Tech Stack:** TypeScript ESM, vitest, no new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-05-21-ide-ai-agent-panel-design.md` §6 (skill artifact content + delivery).

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/create-lorien-api/src/templates.ts` | Modify | Add `SKILL_BODY` constant; rewrite `renderAgentsMd`; add `renderClaudeSkill`. |
| `packages/create-lorien-api/src/templates.test.ts` | Modify | Add tests for `SKILL_BODY`, updated `renderAgentsMd`, `renderClaudeSkill`. |
| `packages/create-lorien-api/src/scaffold.ts` | Modify | Add `.claude/skills/lorien-api/SKILL.md` entry to the files array. |
| `packages/create-lorien-api/src/scaffold.test.ts` | Modify | Expect the new file path among scaffolded outputs. |

No files created. No files deleted. Smallest possible change surface.

---

## Decisions locked in this plan (refinements over the spec)

- **Canonical content location:** `packages/create-lorien-api/src/templates.ts` for Plan A. Spec said `packages/runtime/assets/agent-skill/SKILL.md`. Deferred to Plan B because `create-lorien-api` runs via `npx` and adding `@darrylondil/lorien-runtime` as a dep would bloat the install. Plan B introduces runtime ownership + a sync mechanism when the broker also needs the content.
- **Frontmatter format:** YAML between `---` fences, two keys (`name`, `description`), exactly as Claude Code expects. `AGENTS.md` strips the frontmatter block but keeps the rest verbatim.
- **Version marker:** `<!-- lorien-skill-version: 1 -->` HTML comment is present in `SKILL_BODY` itself (so both files contain it). Reserved for the future `lorien sync-skill` command.
- **`.gitignore` for `.lorien/`:** Already handled by the existing `renderGitignore()` (line 86 of `templates.ts`: `".lorien/"`). No change needed in this plan.

---

## Task 1: Add the canonical skill body constant

Establish the single source of truth that both renderers will consume.

**Files:**
- Modify: `packages/create-lorien-api/src/templates.ts` (add `SKILL_BODY` export + import)
- Test: `packages/create-lorien-api/src/templates.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test to `packages/create-lorien-api/src/templates.test.ts` (inside the `describe("template renderers", () => {` block, before the closing brace):

```ts
  it("SKILL_BODY contains the canonical authoring guide content", () => {
    expect(SKILL_BODY).toMatch(/<!-- lorien-skill-version: 1 -->/)
    expect(SKILL_BODY).toMatch(/# lorien-api project guide/)
    expect(SKILL_BODY).toMatch(/## The node contract/)
    expect(SKILL_BODY).toMatch(/## The \.workflow file format/)
    expect(SKILL_BODY).toMatch(/## What you should NOT do/)
    // node contract example uses the real defineNode shape
    expect(SKILL_BODY).toMatch(/inputs: z\.object/)
    expect(SKILL_BODY).toMatch(/outputs: z\.object/)
    expect(SKILL_BODY).toMatch(/async run/)
    // no YAML frontmatter — that's the SKILL.md renderer's job
    expect(SKILL_BODY.startsWith("---")).toBe(false)
  })
```

Also update the import line at the top of the test file:

```ts
import {
  renderAgentsMd,
  renderBiomeJson,
  renderGitignore,
  renderHelloWorkflow,
  renderLorienConfig,
  renderPackageJson,
  renderReadme,
  renderSayHelloNode,
  renderServerEntry,
  renderTsconfig,
  SKILL_BODY,
} from "./templates.js"
```

- [ ] **Step 2: Run the test and verify it fails**

```
pnpm --filter create-lorien test -- templates.test.ts
```

Expected: FAIL with `SKILL_BODY is not exported from ./templates.js` (or similar import error).

- [ ] **Step 3: Add the constant to `templates.ts`**

Add this near the top of `packages/create-lorien-api/src/templates.ts`, immediately after the `TemplateContext` interface and before `renderPackageJson`:

```ts
/**
 * Canonical authoring guide for AI agents working in a lorien-api project.
 * Used to render both AGENTS.md (no frontmatter) and .claude/skills/lorien-api/SKILL.md
 * (with frontmatter wrapper). Single source of truth — both renderers must use this.
 */
export const SKILL_BODY = `<!-- lorien-skill-version: 1 -->

# lorien-api project guide

This is a lorien-api project. HTTP endpoints are defined as \`.workflow\` files: named-input JSON dependency graphs of typed nodes. Workflows compile to plain TypeScript via \`lorien build\`; the deployed code has zero runtime dependency on lorien-api.

## Layout

\`\`\`
workflows/**/*.workflow   ← HTTP routes (you author these)
nodes/**/*.ts             ← typed compute units, one defineNode per file
lorien.config.ts          ← service registry (db, logger, etc.)
.lorien/                  ← IDE cache, do not edit
.lorien/chats/            ← agent chat transcripts, do not edit
\`\`\`

## The node contract

Every node is exactly one file under \`nodes/\`. Filename is the node name in kebab-case. One default export, returning \`defineNode(...)\`:

\`\`\`ts
import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  name: "Save User",
  inputs: z.object({
    email: z.string().email(),
    passwordHash: z.string(),
  }),
  outputs: z.object({
    id: z.string(),
  }),
  async run({ email, passwordHash }, services) {
    const row = await services.db.users.insert({ email, passwordHash })
    return { id: row.id }
  },
})
\`\`\`

Rules:
- \`inputs\` and \`outputs\` are Zod object schemas.
- \`run\` is \`async\`; receives the typed input and the \`services\` object from \`lorien.config.ts\`.
- Don't throw. Return shaped errors via the output schema if needed.
- One node per file. Filename kebab-case. Export default.

## The .workflow file format

Named-input JSON. Each node lists where its inputs come from inline. No separate edges list:

\`\`\`jsonc
{
  "lorien": 1,
  "nodes": {
    "request": {
      "uses": "@core/http-request",
      "values": { "path": "/users", "method": "POST" }
    },
    "parseBody": {
      "uses": "./nodes/parse-body",
      "in": { "raw": "request.body" }
    },
    "saveUser": {
      "uses": "./nodes/save-user",
      "in": {
        "email": "parseBody.email",
        "passwordHash": "parseBody.passwordHash"
      }
    },
    "response": {
      "uses": "@core/response",
      "in": { "body": "saveUser" }
    }
  }
}
\`\`\`

Rules:
- Keys in \`in\` must match the target node's \`inputs\` schema.
- Values in \`in\` are \`<nodeId>.<outputField>\` references (or just \`<nodeId>\` to pass the whole output object).
- No cycles.
- A \`view\` block (when present) is IDE-only layout metadata. After hand-editing, you may set it to \`null\` and the IDE will re-lay-out.

## Authoring recipes

**Add a new node**
1. Create \`nodes/<name>.ts\` following the node contract.
2. Reference it from a workflow via \`"uses": "./nodes/<name>"\`.

**Wire a new node into a workflow**
1. Add an entry under \`nodes\` with \`uses\` pointing to the node file.
2. In its \`in\` block, reference upstream outputs as \`<id>.<field>\`.

**Add a service (db, logger, etc.)**
1. Edit \`lorien.config.ts\` and add to the \`services\` object.
2. Destructure it from the second argument of \`run()\` in any node that needs it.

**Add an OpenAPI-typed HTTP client**
1. Run \`lorien openapi add <url-or-path>\`.
2. Generated client nodes appear under \`nodes/<api>/\` — use them like any other node.

## Verification

After edits, run:

\`\`\`
pnpm typecheck && pnpm test
\`\`\`

Tests live next to nodes in \`*.test.ts\` files and use \`testWorkflow\` / \`traceWorkflow\` from \`@darrylondil/lorien-runtime/testing\`.

## What you should NOT do

- Don't add \`@darrylondil/lorien-runtime\` as a *runtime* dep in user code — it's build-time only. The compiled output has no runtime dep on lorien.
- Don't hand-edit anything under \`.lorien/\` (IDE cache + chat transcripts).
- Don't introduce an edges-array workflow format. lorien-api is named-input style: each node declares its own inputs.
- Don't add middleware-style global error handling. Handle errors at the node level by returning shaped output.
`
```

- [ ] **Step 4: Run the test and verify it passes**

```
pnpm --filter create-lorien test -- templates.test.ts
```

Expected: all `template renderers` tests pass, including the new `SKILL_BODY contains the canonical authoring guide content`.

- [ ] **Step 5: Commit**

```
git add packages/create-lorien-api/src/templates.ts packages/create-lorien-api/src/templates.test.ts
git commit -m "feat(create-lorien): canonical SKILL_BODY constant for agent guide"
```

---

## Task 2: Rewrite `renderAgentsMd` to use `SKILL_BODY`

Replace the existing project-specific `renderAgentsMd` body with the canonical content (no frontmatter). The function still takes `TemplateContext` for backwards-compatible signature, but no longer interpolates `ctx.name` — the canonical body is project-agnostic.

**Files:**
- Modify: `packages/create-lorien-api/src/templates.ts`
- Modify: `packages/create-lorien-api/src/templates.test.ts`

- [ ] **Step 1: Update the existing `AGENTS.md` test to match the new shape**

Replace this existing test in `packages/create-lorien-api/src/templates.test.ts`:

```ts
  it("AGENTS.md contains the project name", () => {
    expect(renderAgentsMd(ctx)).toMatch(/my-app/)
    expect(renderAgentsMd(ctx)).toMatch(/lorien-api/)
  })
```

With:

```ts
  it("AGENTS.md is the canonical SKILL_BODY with no frontmatter", () => {
    const out = renderAgentsMd(ctx)
    expect(out.startsWith("---")).toBe(false)
    expect(out).toMatch(/# lorien-api project guide/)
    expect(out).toMatch(/## The node contract/)
    expect(out).toMatch(/<!-- lorien-skill-version: 1 -->/)
    // Project name is intentionally NOT interpolated — guide is generic.
    expect(out).not.toMatch(/my-app/)
    // Trailing newline preserved
    expect(out.endsWith("\n")).toBe(true)
  })
```

- [ ] **Step 2: Run the test and verify it fails**

```
pnpm --filter create-lorien test -- templates.test.ts
```

Expected: FAIL — the existing `renderAgentsMd` still includes "my-app" via `ctx.name`.

- [ ] **Step 3: Rewrite `renderAgentsMd` in `templates.ts`**

Replace the entire existing `renderAgentsMd` function (lines 158–208 of the file, the big template literal with "AI agent guide for ${ctx.name}") with:

```ts
export function renderAgentsMd(_ctx: TemplateContext): string {
  return SKILL_BODY
}
```

Note: the `_ctx` parameter is kept (underscore-prefixed) to preserve the existing signature. Callers in `scaffold.ts` still pass it.

- [ ] **Step 4: Run the test and verify it passes**

```
pnpm --filter create-lorien test -- templates.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add packages/create-lorien-api/src/templates.ts packages/create-lorien-api/src/templates.test.ts
git commit -m "refactor(create-lorien): renderAgentsMd uses canonical SKILL_BODY"
```

---

## Task 3: Add `renderClaudeSkill` (body + Claude Code frontmatter)

A second renderer for `.claude/skills/lorien-api/SKILL.md`. Wraps `SKILL_BODY` in YAML frontmatter so Claude Code auto-loads it when working in the project.

**Files:**
- Modify: `packages/create-lorien-api/src/templates.ts`
- Modify: `packages/create-lorien-api/src/templates.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/create-lorien-api/src/templates.test.ts` (inside the `describe` block):

```ts
  it("renderClaudeSkill wraps SKILL_BODY with valid Claude Code frontmatter", () => {
    const out = renderClaudeSkill()
    // YAML frontmatter present and well-formed
    expect(out.startsWith("---\n")).toBe(true)
    expect(out).toMatch(/^---\nname: lorien-api\ndescription: .+\n---\n\n/)
    // description is a single line (skill loader requires this), non-empty
    const descMatch = out.match(/^description: (.+)$/m)
    expect(descMatch).not.toBeNull()
    expect(descMatch![1].length).toBeGreaterThan(40)
    expect(descMatch![1]).not.toContain("\n")
    // Body follows the frontmatter
    expect(out).toMatch(/# lorien-api project guide/)
    expect(out).toMatch(/<!-- lorien-skill-version: 1 -->/)
    // Trailing newline preserved
    expect(out.endsWith("\n")).toBe(true)
  })
```

Update the import line at the top of the test file to add `renderClaudeSkill`:

```ts
import {
  renderAgentsMd,
  renderBiomeJson,
  renderClaudeSkill,
  renderGitignore,
  renderHelloWorkflow,
  renderLorienConfig,
  renderPackageJson,
  renderReadme,
  renderSayHelloNode,
  renderServerEntry,
  renderTsconfig,
  SKILL_BODY,
} from "./templates.js"
```

- [ ] **Step 2: Run the test and verify it fails**

```
pnpm --filter create-lorien test -- templates.test.ts
```

Expected: FAIL with `renderClaudeSkill is not exported from ./templates.js`.

- [ ] **Step 3: Add `renderClaudeSkill` in `templates.ts`**

Add this function in `packages/create-lorien-api/src/templates.ts`, immediately after `renderAgentsMd`:

```ts
/**
 * Renders the Claude Code skill file (.claude/skills/lorien-api/SKILL.md).
 * Wraps SKILL_BODY in YAML frontmatter so Claude auto-loads it when working
 * in the project. The `description` is what Claude reads to decide whether
 * the skill applies to the current task.
 */
export function renderClaudeSkill(): string {
  const frontmatter = [
    "---",
    "name: lorien-api",
    "description: Use when authoring or editing files in a lorien-api project — workflows (.workflow JSON dependency graphs), nodes (typed defineNode modules), or lorien.config.ts (service registry). Triggers on edits in workflows/, nodes/, or any file ending in .workflow.",
    "---",
    "",
  ].join("\n")
  return `${frontmatter}\n${SKILL_BODY}`
}
```

- [ ] **Step 4: Run the test and verify it passes**

```
pnpm --filter create-lorien test -- templates.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```
git add packages/create-lorien-api/src/templates.ts packages/create-lorien-api/src/templates.test.ts
git commit -m "feat(create-lorien): renderClaudeSkill emits .claude skill file with frontmatter"
```

---

## Task 4: Write `.claude/skills/lorien-api/SKILL.md` during scaffold

Hook `renderClaudeSkill` into `scaffold.ts` so new projects get both `AGENTS.md` and the Claude skill file.

**Files:**
- Modify: `packages/create-lorien-api/src/scaffold.ts`
- Modify: `packages/create-lorien-api/src/scaffold.test.ts`

- [ ] **Step 1: Update the scaffold test to expect the new file**

In `packages/create-lorien-api/src/scaffold.test.ts`, update the `expected` array in the first test to include the skill path:

```ts
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
```

Also add a new test inside the same `describe("scaffold", …)` block that asserts the skill file contents:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

```
pnpm --filter create-lorien test -- scaffold.test.ts
```

Expected: FAIL — the first test fails because `.claude/skills/lorien-api/SKILL.md` doesn't exist; the new tests fail for the same reason (file missing).

- [ ] **Step 3: Update `scaffold.ts`**

Replace `packages/create-lorien-api/src/scaffold.ts` entirely with:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PackageManager } from "./detect-package-manager.js";
import {
  renderAgentsMd,
  renderBiomeJson,
  renderClaudeSkill,
  renderGitignore,
  renderHelloWorkflow,
  renderLorienConfig,
  renderPackageJson,
  renderReadme,
  renderSayHelloNode,
  renderServerEntry,
  renderTsconfig,
} from "./templates.js";

export interface ScaffoldOptions {
  target: string;
  name: string;
  pm: PackageManager;
}

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const { target, name, pm } = opts;
  const ctx = { name };

  const files: Array<[string, string]> = [
    [".gitignore", renderGitignore()],
    ["package.json", renderPackageJson(ctx)],
    ["tsconfig.json", renderTsconfig()],
    ["biome.json", renderBiomeJson()],
    ["lorien.config.ts", renderLorienConfig()],
    ["workflows/hello.workflow", renderHelloWorkflow()],
    ["nodes/say-hello.ts", renderSayHelloNode()],
    ["src/server.ts", renderServerEntry()],
    ["AGENTS.md", renderAgentsMd(ctx)],
    [".claude/skills/lorien-api/SKILL.md", renderClaudeSkill()],
    ["README.md", renderReadme(ctx, pm)],
  ];

  for (const [relPath, contents] of files) {
    const abs = join(target, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents, "utf-8");
  }
}
```

The only change from the existing file: added `renderClaudeSkill` to the imports and one new tuple in the `files` array.

- [ ] **Step 4: Run the test and verify it passes**

```
pnpm --filter create-lorien test
```

Expected: all `scaffold` and `template renderers` tests pass.

- [ ] **Step 5: Commit**

```
git add packages/create-lorien-api/src/scaffold.ts packages/create-lorien-api/src/scaffold.test.ts
git commit -m "feat(create-lorien): scaffold .claude/skills/lorien-api/SKILL.md alongside AGENTS.md"
```

---

## Task 5: End-to-end smoke test with the built CLI

Verify the published-shape works: build the CLI, scaffold a real project into a tmpdir, inspect the produced files.

**Files:** No code changes. This task is operational.

- [ ] **Step 1: Build the CLI**

```
pnpm --filter create-lorien build
```

Expected: `packages/create-lorien-api/dist/cli.js` exists; no errors.

- [ ] **Step 2: Scaffold a throwaway project**

The CLI (`packages/create-lorien-api/src/cli.ts`) accepts `<name>` + `--skip-install` and writes into `${cwd}/${name}`. So `cd` into a fresh tmp dir first. From the repo root, in PowerShell:

```powershell
$repo = (Get-Location).Path
$tmp = Join-Path $env:TEMP "lorien-skill-smoke-$([guid]::NewGuid().ToString().Substring(0,8))"
New-Item -ItemType Directory -Path $tmp | Out-Null
Push-Location $tmp
try {
  node "$repo/packages/create-lorien-api/dist/cli.js" smoke-app --skip-install
} finally {
  Pop-Location
}
```

Expected: CLI exits 0; `$tmp/smoke-app/` exists with the scaffolded files.

- [ ] **Step 3: Inspect the produced files**

```powershell
Get-Content "$tmp/smoke-app/AGENTS.md" -TotalCount 5
Get-Content "$tmp/smoke-app/.claude/skills/lorien-api/SKILL.md" -TotalCount 8
```

Expected output, AGENTS.md head:
```
<!-- lorien-skill-version: 1 -->

# lorien-api project guide

This is a lorien-api project. ...
```

Expected output, SKILL.md head:
```
---
name: lorien-api
description: Use when authoring or editing files in a lorien-api project — workflows ...
---

<!-- lorien-skill-version: 1 -->

# lorien-api project guide
```

- [ ] **Step 4: Cleanup**

```powershell
Remove-Item -Recurse -Force $tmp
```

- [ ] **Step 5: No commit (operational task)**

Nothing to commit; this task just validates the build.

---

## Done criteria

All checked:

- [ ] `pnpm --filter create-lorien test` — all green.
- [ ] `pnpm --filter create-lorien typecheck` — clean.
- [ ] `pnpm --filter create-lorien build` — clean.
- [ ] Smoke-tested project contains both `AGENTS.md` and `.claude/skills/lorien-api/SKILL.md` with the canonical content.
- [ ] 4 commits on the branch (one per task 1–4; task 5 is operational).

## What this plan does NOT do (deferred to Plan B / C)

- No runtime-side `SKILL_MARKDOWN` export or `writeProjectSkill` function. Deferred until the agent broker (Plan B) also needs the content.
- No sync mechanism between `create-lorien-api` and runtime — only one copy exists, in `create-lorien-api`.
- No `lorien sync-skill` command for existing projects to refresh.
- No IDE pane, no WebSocket bridge, no subprocess spawning, no chat UI.
