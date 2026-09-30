import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  type AnyNodeOrTrigger,
  importNodes,
  parseWorkflowFromString,
  type Services,
  type WorkflowFile,
} from "@darrylondil/lorien-runtime"
import { openPetStoreDb, type PetStoreDb } from "../providers/db/open.js"

const root = join(import.meta.dirname, "..")

/** Parses `workflows/<name>.workflow`, e.g. `loadWorkflow("pets/add")`. */
export async function loadWorkflow(name: string): Promise<WorkflowFile> {
  return parseWorkflowFromString(
    await readFile(join(root, "workflows", `${name}.workflow`), "utf-8"),
  )
}

let nodes: Promise<Record<string, AnyNodeOrTrigger>> | undefined

/**
 * What a workflow test passes to testWorkflow / traceWorkflow: every node in
 * nodes/, and services backed by a fresh, seeded in-memory pet store.
 */
export async function petStore(): Promise<{
  db: PetStoreDb
  nodes: Record<string, AnyNodeOrTrigger>
  services: Services
}> {
  nodes ??= importNodes(root).then((r) => r.nodes)
  const db = openPetStoreDb(":memory:")
  return {
    db,
    nodes: await nodes,
    services: { db, logger: { info() {} } } as Services,
  }
}
