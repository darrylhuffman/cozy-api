import type { AnyNodeOrTrigger } from "../types.js"
import variable from "./data/variable.js"
import and from "./logic/and.js"
import ifElse from "./logic/if.js"
import not from "./logic/not.js"
import or from "./logic/or.js"
import switchNode from "./logic/switch.js"
import httpResponse from "./responses/http-response.js"
import { subworkflowInput, subworkflowOutput } from "./subworkflows/io.js"
import httpRequest from "./triggers/http-request.js"
import schedule from "./triggers/schedule.js"

/** The folder a core node is listed under in the IDE's Nodes panel. */
export type CoreCategory = "triggers" | "logic" | "data" | "responses" | "subworkflows"

const CORE_REGISTRY: Record<string, { node: AnyNodeOrTrigger; category: CoreCategory }> = {
  "@core/http-request": { node: httpRequest, category: "triggers" },
  "@core/schedule": { node: schedule, category: "triggers" },
  "@core/if": { node: ifElse, category: "logic" },
  "@core/switch": { node: switchNode, category: "logic" },
  "@core/and": { node: and, category: "logic" },
  "@core/or": { node: or, category: "logic" },
  "@core/not": { node: not, category: "logic" },
  "@core/variable": { node: variable, category: "data" },
  "@core/http-response": { node: httpResponse, category: "responses" },
  "@core/input": { node: subworkflowInput, category: "subworkflows" },
  "@core/output": { node: subworkflowOutput, category: "subworkflows" },
}

/** The canonical HTTP response node. */
export const HTTP_RESPONSE = "@core/http-response"

/** Old names that still resolve, so existing workflow files keep working. */
const CORE_ALIASES: Record<string, string> = {
  "@core/response": HTTP_RESPONSE,
}

/** The current id for a core `uses`, following renames ("@core/response" → "@core/http-response"). */
export function canonicalCoreId(uses: string): string {
  return CORE_ALIASES[uses] ?? uses
}

/** True for the node that ends a run with an HTTP response, under its current or old name. */
export function isHttpResponse(uses: string): boolean {
  return canonicalCoreId(uses) === HTTP_RESPONSE
}

export function resolveCoreNode(uses: string): AnyNodeOrTrigger | null {
  return CORE_REGISTRY[canonicalCoreId(uses)]?.node ?? null
}

export function coreCategory(uses: string): CoreCategory | null {
  return CORE_REGISTRY[canonicalCoreId(uses)]?.category ?? null
}

export function isCoreReference(uses: string): boolean {
  return uses.startsWith("@core/")
}

export const CORE_NODE_IDS = Object.keys(CORE_REGISTRY)
