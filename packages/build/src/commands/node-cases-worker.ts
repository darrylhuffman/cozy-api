/**
 * Node-cases worker — runs as a tsx subprocess in the user's workspace so every
 * run imports the node files fresh (edits apply without restarting the IDE) and
 * a node that hangs or crashes can't take the IDE server down.
 *
 * argv: <workspaceRoot> <json options for runNodeCases (filter, only)>
 * stdout: anything the nodes log, then one line `<MARKER><json results>`.
 */
import { runNodeCases } from "@darrylondil/lorien-runtime/testing"

const RESULT_MARKER = "__LORIEN_NODE_CASES__"

async function main() {
  const root = process.argv[2]
  if (!root) throw new Error("usage: node-cases-worker <root> [options-json]")
  const opts = JSON.parse(process.argv[3] ?? "{}") as {
    filter?: string
    only?: Record<string, string[]>
  }
  const files = await runNodeCases({ root, ...opts })
  process.stdout.write(`\n${RESULT_MARKER}${JSON.stringify(files)}\n`)
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`)
    process.exit(1)
  },
)
