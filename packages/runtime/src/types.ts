import type { z } from "zod"

/**
 * Augmentable interface populated by the IDE's type generator from cozy.config.ts.
 * Users never write this themselves; .cozy/types/services.d.ts declares it.
 * Must remain an interface (not a type alias) to support declaration merging.
 */
// biome-ignore lint/suspicious/noEmptyInterface: intentional — users augment via declaration merging
export interface Services {}

export interface ServiceContext {
  requestId: string
  timestamp: number
}

export type ServiceValue<T = unknown> = T | ((ctx: ServiceContext) => T | Promise<T>)

export interface Disposable {
  dispose?(): void | Promise<void>
}

export interface WorkflowConfig {
  target: "hono"
  services: Record<string, ServiceValue<unknown>>
}

export type ZodObjectAny = z.ZodObject<z.ZodRawShape>

export interface Node<
  I extends ZodObjectAny = ZodObjectAny,
  O extends ZodObjectAny = ZodObjectAny,
  C extends ZodObjectAny | undefined = ZodObjectAny | undefined,
> {
  readonly kind: "node"
  readonly name?: string
  readonly inputs: I
  readonly outputs: O
  readonly config?: C
  run(
    input: z.infer<I>,
    services: Services,
    config: C extends ZodObjectAny ? z.infer<C> : undefined,
  ): Promise<z.infer<O>>
}

export interface Trigger<
  O extends ZodObjectAny = ZodObjectAny,
  C extends ZodObjectAny | undefined = ZodObjectAny | undefined,
> {
  readonly kind: "trigger"
  readonly name?: string
  readonly outputs: O
  readonly config?: C
}

export type AnyNodeOrTrigger = Node | Trigger
