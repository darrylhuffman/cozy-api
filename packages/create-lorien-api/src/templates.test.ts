import { describe, expect, it } from "vitest"
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

const ctx = { name: "my-app" }

describe("template renderers", () => {
  it("package.json parses as JSON and has the project name", () => {
    const out = renderPackageJson(ctx)
    const pkg = JSON.parse(out)
    expect(pkg.name).toBe("my-app")
    expect(pkg.type).toBe("module")
    expect(pkg.scripts.dev).toBe("lorien dev")
    expect(pkg.scripts["dev:server"]).toBe("lorien dev --no-ide")
    expect(pkg.scripts.build).toBe("lorien build")
    expect(pkg.scripts.start).toBe("node dist/index.js")
    expect(pkg.devDependencies["@darrylondil/lorien-build"]).toBe("latest")
    expect(pkg.devDependencies["@darrylondil/lorien-runtime"]).toBe("latest")
    expect(pkg.dependencies.hono).toMatch(/^\^/)
  })

  it("tsconfig.json parses as JSON with strict + NodeNext", () => {
    const tc = JSON.parse(renderTsconfig())
    expect(tc.compilerOptions.strict).toBe(true)
    expect(tc.compilerOptions.module).toBe("NodeNext")
  })

  it("biome.json parses as JSON and references 2.4.15 schema", () => {
    const b = JSON.parse(renderBiomeJson())
    expect(b.$schema).toMatch(/2\.4\.15/)
    expect(b.javascript.formatter.semicolons).toBe("asNeeded")
  })

  it("gitignore is non-empty and includes node_modules", () => {
    expect(renderGitignore()).toMatch(/node_modules/)
  })

  it("lorien.config.ts contains defineConfig", () => {
    expect(renderLorienConfig()).toMatch(/defineConfig/)
  })

  it("hello.workflow parses as JSON and is a valid lorien v1 file", () => {
    const wf = JSON.parse(renderHelloWorkflow())
    expect(wf.lorien).toBe(1)
    expect(wf.nodes.request.values.path).toBe("/hello")
    expect(wf.nodes.say.uses).toBe("./nodes/say-hello")
  })

  it("say-hello.ts mentions defineNode", () => {
    expect(renderSayHelloNode()).toMatch(/defineNode/)
    expect(renderSayHelloNode()).toMatch(/Hello from lorien-api/)
  })

  it("server.ts uses startLorienServer + serve", () => {
    expect(renderServerEntry()).toMatch(/startLorienServer/)
    expect(renderServerEntry()).toMatch(/@hono\/node-server/)
  })

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

  it("README has the project name and uses the chosen package manager (pnpm)", () => {
    const md = renderReadme(ctx, "pnpm")
    expect(md).toMatch(/^# my-app/m)
    expect(md).toMatch(/pnpm dev/)
    expect(md).toMatch(/pnpm dev:server/)
    expect(md).toMatch(/pnpm build/)
    expect(md).toMatch(/pnpm test/)
  })

  it("README uses npm run prefix for npm", () => {
    const md = renderReadme(ctx, "npm")
    expect(md).toMatch(/npm run dev/)
    expect(md).toMatch(/npm run test/)
  })

  it("README uses yarn prefix for yarn", () => {
    const md = renderReadme(ctx, "yarn")
    expect(md).toMatch(/yarn dev/)
    expect(md).toMatch(/yarn test/)
  })

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
})
