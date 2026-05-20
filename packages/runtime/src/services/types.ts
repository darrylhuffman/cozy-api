import type { ServiceContext, ServiceValue, WorkflowConfig } from "../types.js"

export type ResolvedServices = Record<string, unknown>

export interface ServiceResolver {
  /** Resolves the services bag for a single workflow run. Calls factories once. */
  resolve(ctx: ServiceContext): Promise<ResolvedServices>
}

export type ServicesConfig = WorkflowConfig["services"]
export type { ServiceContext, ServiceValue }
