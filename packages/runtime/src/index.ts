export const VERSION = "0.0.0"
export { defineConfig } from "./define-config.js"
export type { DefineNodeInput } from "./define-node.js"
export { defineNode } from "./define-node.js"
export type { DefineTriggerInput } from "./define-trigger.js"
export { defineTrigger } from "./define-trigger.js"
export type {
  AnyNodeOrTrigger,
  Disposable,
  Node,
  ServiceContext,
  Services,
  ServiceValue,
  Trigger,
  WorkflowConfig,
  ZodObjectAny,
} from "./types.js"
