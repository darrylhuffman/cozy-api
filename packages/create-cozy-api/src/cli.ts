import { readdir, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { detectPackageManager } from "./detect-package-manager.js"
import { validateName } from "./validate-name.js"

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const name = argv[0]
  if (!name) {
    console.error("Usage: create-cozy-api <name>")
    process.exit(1)
  }

  const validation = validateName(name)
  if (!validation.ok) {
    console.error(`Invalid project name '${name}': ${validation.reason}`)
    process.exit(1)
  }

  const target = resolve(process.cwd(), name)
  if (await dirIsNonEmpty(target)) {
    console.error(
      `Target directory ${target} already exists and is non-empty. Refusing to overwrite.`,
    )
    process.exit(1)
  }

  const pm = detectPackageManager()
  console.log(`create-cozy-api: would scaffold '${name}' at ${target} using ${pm}`)
  console.log("(template rendering + install land in Tasks 32-33)")
}

async function dirIsNonEmpty(p: string): Promise<boolean> {
  try {
    const s = await stat(p)
    if (!s.isDirectory()) return true
    const entries = await readdir(p)
    return entries.length > 0
  } catch {
    return false
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
