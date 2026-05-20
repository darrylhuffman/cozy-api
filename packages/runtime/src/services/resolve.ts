import type { ServiceContext } from "../types.js"
import type { ResolvedServices, ServiceResolver, ServicesConfig } from "./types.js"

export function createServiceResolver(services: ServicesConfig): ServiceResolver {
  return {
    async resolve(ctx: ServiceContext): Promise<ResolvedServices> {
      const resolved: ResolvedServices = {}
      for (const [name, value] of Object.entries(services)) {
        if (typeof value === "function") {
          resolved[name] = await (value as (c: ServiceContext) => unknown)(ctx)
        } else {
          resolved[name] = value
        }
      }
      return resolved
    },
  }
}
