import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { collectWorkspaceTypes } from "./workspace-types.js"

let root: string

async function put(rel: string, content: string | object) {
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, typeof content === "string" ? content : JSON.stringify(content))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "lorien-types-"))
  await put("package.json", {
    dependencies: { zod: "^4" },
    devDependencies: { "@types/node": "^25", typescript: "^6" },
  })
  await put("node_modules/zod/package.json", { name: "zod", types: "index.d.ts" })
  await put("node_modules/zod/index.d.ts", "export declare const z: unknown")
  await put("node_modules/zod/index.js", "export const z = {}")
  await put("node_modules/zod/v4/core/core.d.cts", "export {}")
  await put("node_modules/@types/node/package.json", {
    name: "@types/node",
    dependencies: { "undici-types": "*" },
    peerDependencies: { jsdom: "*" },
    peerDependenciesMeta: { jsdom: { optional: true } },
  })
  await put("node_modules/@types/node/index.d.ts", "declare var process: unknown")
  await put("node_modules/undici-types/package.json", { name: "undici-types" })
  await put("node_modules/undici-types/index.d.ts", "export {}")
  await put("node_modules/jsdom/package.json", { name: "jsdom" })
  await put("node_modules/jsdom/index.d.ts", "export {}")
  await put("node_modules/typescript/package.json", { name: "typescript" })
  await put("node_modules/typescript/lib/lib.d.ts", "declare var x: 1")
  await put(".lorien/types/services.d.ts", "export {}")
})

async function putSources() {
  await put("src/db.ts", "export const db = 1")
  await put("src/db.test.ts", "export {}")
  await put("lorien.config.ts", "export default {}")
  await put("nodes/pets/add-pet.ts", "export {}")
  await put("workflows/pets/add.test.ts", "export {}")
  await put("dist/server.d.ts", "export {}")
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("collectWorkspaceTypes", () => {
  it("collects declarations and package.json files for dependencies, transitively", async () => {
    const { files, skipped } = await collectWorkspaceTypes(root)
    expect(files.map((f) => f.path).sort()).toEqual([
      ".lorien/types/services.d.ts",
      "node_modules/@types/node/index.d.ts",
      "node_modules/@types/node/package.json",
      "node_modules/undici-types/index.d.ts",
      "node_modules/undici-types/package.json",
      "node_modules/zod/index.d.ts",
      "node_modules/zod/package.json",
      "node_modules/zod/v4/core/core.d.cts",
    ])
    expect(skipped).toEqual([])
  })

  it("includes the project's own shared sources, but not nodes, workflows, tests or build output", async () => {
    await putSources()
    const { files } = await collectWorkspaceTypes(root)
    const own = files.map((f) => f.path).filter((p) => !p.startsWith("node_modules/"))
    expect(own.sort()).toEqual([".lorien/types/services.d.ts", "lorien.config.ts", "src/db.ts"])
  })

  it("drops packages that don't fit the size budget instead of failing", async () => {
    const { files, skipped } = await collectWorkspaceTypes(root, 120)
    expect(files.some((f) => f.path.startsWith("node_modules/zod/"))).toBe(true)
    expect(skipped).toContain("@types/node")
  })
})
