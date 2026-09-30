import { describe, expect, it } from "vitest"
import {
  lorienRange,
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

const ctx = { name: "my-app" }

describe("template renderers", () => {
  it("package.json parses as JSON and has the project name", () => {
    const out = renderPackageJson(ctx)
    const pkg = JSON.parse(out)
    expect(pkg.name).toBe("my-app")
    expect(pkg.type).toBe("module")
    expect(pkg.scripts.dev).toBe("lorien dev")
    expect(pkg.scripts["dev:server"]).toBe("lorien dev --no-ide")
    expect(pkg.scripts.build).toBe("lorien build --typecheck")
    expect(pkg.scripts.start).toBe("node dist/index.js")
    // The release line this scaffolder belongs to, never "latest".
    expect(pkg.devDependencies["@darrylondil/lorien-build"]).toMatch(/^\^\d+\.\d+\.0$/)
    expect(pkg.devDependencies["@darrylondil/lorien-runtime"]).toBe(
      pkg.devDependencies["@darrylondil/lorien-build"],
    )
    expect(pkg.dependencies.hono).toMatch(/^\^/)
  })

  it("package.json can run the biome.json it ships, and lets pnpm build esbuild", () => {
    const pkg = JSON.parse(renderPackageJson(ctx))
    expect(pkg.scripts.lint).toBe("biome check .")
    expect(pkg.devDependencies["@biomejs/biome"]).toMatch(/^\^2\./)
    expect(pkg.pnpm.onlyBuiltDependencies).toEqual(["esbuild"])
  })

  it("package.json keeps vitest on 4.0, which npm 10 can install", () => {
    const pkg = JSON.parse(renderPackageJson(ctx))
    expect(pkg.devDependencies.vitest).toMatch(/^~4\.0\./)
  })

  it("lorienRange asks for the scaffolder's release line", () => {
    expect(lorienRange("0.2.1")).toBe("^0.2.0")
    expect(lorienRange("1.4.0")).toBe("^1.4.0")
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
    expect(renderSayHelloNode()).toMatch(/Hello from lorien!/)
  })

  it("server.ts uses startLorienServer + serve + agent broker", () => {
    const out = renderServerEntry()
    expect(out).toMatch(/startLorienServer/)
    expect(out).toMatch(/@hono\/node-server/)
    expect(out).toMatch(/mountAgentBroker/)
    expect(out).toMatch(/attachAgentBroker/)
  })

  it("AGENTS.md is the canonical SKILL_BODY with no frontmatter", () => {
    const out = renderAgentsMd()
    expect(out.startsWith("---")).toBe(false)
    expect(out).toMatch(/# lorien project guide/)
    expect(out).toMatch(/## The node contract/)
    expect(out).toMatch(/<!-- lorien-skill-version: 6 -->/)
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
    expect(SKILL_BODY).toMatch(/<!-- lorien-skill-version: 6 -->/)
    expect(SKILL_BODY).toMatch(/# lorien project guide/)
    expect(SKILL_BODY).toMatch(/## The node contract/)
    expect(SKILL_BODY).toMatch(/## The \.workflow file format/)
    expect(SKILL_BODY).toMatch(/## What you should NOT do/)
    expect(SKILL_BODY).toMatch(/defineMiddleware/)
    expect(SKILL_BODY).toMatch(/selector: "db"/)
    expect(SKILL_BODY).toMatch(/npx lorien check/)
    expect(SKILL_BODY).toMatch(/providers\["http-client"\]/)
    // node contract example uses the real defineNode shape
    expect(SKILL_BODY).toMatch(/inputs: z\.object/)
    expect(SKILL_BODY).toMatch(/outputs: z\.object/)
    expect(SKILL_BODY).toMatch(/async run/)
    // no YAML frontmatter — that's the SKILL.md renderer's job
    expect(SKILL_BODY.startsWith("---")).toBe(false)
  })

  it("renderClaudeSkill wraps SKILL_BODY with valid Claude Code frontmatter", () => {
    const out = renderClaudeSkill()
    // YAML frontmatter present and well-formed
    expect(out.startsWith("---\n")).toBe(true)
    expect(out).toMatch(/^---\nname: lorien-api\ndescription: .+\n---\n\n/)
    // description is a single line (skill loader requires this), non-empty
    const descMatch = out.match(/^description: (.+)$/m)
    expect(descMatch).not.toBeNull()
    expect(descMatch![1].length).toBeGreaterThan(40)
    // Multi-line descriptions break Claude Code's YAML frontmatter parser.
    // Guard by asserting the frontmatter block contains exactly the three
    // expected lines between the --- fences.
    const fmMatch = out.match(/^---\n([\s\S]*?)\n---\n/)
    expect(fmMatch).not.toBeNull()
    const fmLines = fmMatch![1].split("\n")
    expect(fmLines).toHaveLength(2) // name + description, no continuation lines
    // Body follows the frontmatter
    expect(out).toMatch(/# lorien project guide/)
    expect(out).toMatch(/<!-- lorien-skill-version: 6 -->/)
    // Trailing newline preserved
    expect(out.endsWith("\n")).toBe(true)
  })
})
