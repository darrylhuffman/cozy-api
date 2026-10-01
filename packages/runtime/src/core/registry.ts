import type { AnyNodeOrTrigger } from "../types.js"
import httpRequest from "./http-request.js"
import response from "./response.js"
import { subworkflowInput, subworkflowOutput } from "./subworkflow-io.js"
import schedule from "./triggers/schedule.js"
import variable from "./variable.js"

const CORE_REGISTRY: Record<string, AnyNodeOrTrigger> = {
  "@core/http-request": httpRequest,
  "@core/response": response,
  "@core/schedule": schedule,
  "@core/variable": variable,
  "@core/input": subworkflowInput,
  "@core/output": subworkflowOutput,
}

export function resolveCoreNode(uses: string): AnyNodeOrTrigger | null {
  return CORE_REGISTRY[uses] ?? null
}

export function isCoreReference(uses: string): boolean {
  return uses.startsWith("@core/")
}

export const CORE_NODE_IDS = Object.keys(CORE_REGISTRY)
