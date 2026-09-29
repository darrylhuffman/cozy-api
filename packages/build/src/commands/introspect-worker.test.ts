import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdirSync, writeFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { extractTSDoc, parseJsDocText } from "./introspect-worker.js"

// Helper: write a temp file and return its absolute path
function tmpFile(name: string, content: string): string {
  const dir = join(tmpdir(), "introspect-worker-test")
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, content, "utf-8")
  return p
}

describe("parseJsDocText", () => {
  it("strips /** and */ delimiters and per-line * prefixes", () => {
    const raw = `/**
 * Hello world.
 * Second line.
 */`
    expect(parseJsDocText(raw)).toBe("Hello world.\nSecond line.")
  })

  it("handles single-line jsdoc", () => {
    const raw = `/** Short description. */`
    expect(parseJsDocText(raw)).toBe("Short description.")
  })
})

describe("extractTSDoc", () => {
  it("extracts JSDoc directly above `export default defineNode(...)`", () => {
    const p = tmpFile(
      "direct-export.ts",
      `import { defineNode } from "somewhere"
/**
 * This is the node description.
 */
export default defineNode({ name: "Test" })
`,
    )
    const result = extractTSDoc(p)
    expect(result).toBe("This is the node description.")
  })

  it("extracts JSDoc from the named variable when `export default name`", () => {
    const p = tmpFile(
      "named-var.ts",
      `import { defineNode } from "somewhere"
/**
 * Variable-level description.
 */
const node = defineNode({ name: "Test" })
export default node
`,
    )
    const result = extractTSDoc(p)
    expect(result).toBe("Variable-level description.")
  })

  it("extracts first JSDoc inside the defineNode object literal (run method pattern)", () => {
    const p = tmpFile(
      "run-jsdoc.ts",
      `import { defineNode } from "somewhere"
export default defineNode({
  name: "Save User",
  /**
   * Creates a demo user record.
   *
   * @param input - The email and password.
   * @returns The created user.
   */
  async run({ email }) {
    return { email }
  },
})
`,
    )
    const result = extractTSDoc(p)
    expect(result).toContain("Creates a demo user record.")
  })

  it("returns null when there is no JSDoc anywhere", () => {
    const p = tmpFile(
      "no-jsdoc.ts",
      `import { defineNode } from "somewhere"
export default defineNode({ name: "Test" })
`,
    )
    const result = extractTSDoc(p)
    expect(result).toBeNull()
  })

  it("returns null for a non-existent file", () => {
    expect(extractTSDoc("/does/not/exist.ts")).toBeNull()
  })

  it("extracts the save-user.ts pattern: JSDoc on the run property inside defineNode", () => {
    // Mirrors the actual examples/basic-api/nodes/users/save-user.ts structure
    const p = tmpFile(
      "save-user-pattern.ts",
      `import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"

export default defineNode({
  name: "Save User",
  color: "yellow",
  inputs: z.object({ email: z.string(), password: z.string() }),
  outputs: z.object({ user: z.object({ id: z.string(), email: z.string() }) }),
  /**
   * Creates a demo user record from the validated workflow inputs.
   *
   * @param input - The email and plain-text password supplied by the workflow.
   * @returns The created user object exposed on the node's \`user\` output.
   */
  async run({ email, password }, services) {
    return { user: { id: "1", email } }
  },
})
`,
    )
    const result = extractTSDoc(p)
    expect(result).not.toBeNull()
    expect(result).toContain("Creates a demo user record from the validated workflow inputs.")
  })
})
