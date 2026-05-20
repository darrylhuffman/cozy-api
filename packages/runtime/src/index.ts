// Helpers

// Built-ins
export {
  CORE_NODE_IDS,
  isCoreReference,
  resolveCoreNode,
} from "./core/registry.js";
export { defineConfig } from "./define-config.js";
export type { DefineNodeInput } from "./define-node.js";
export { defineNode } from "./define-node.js";
export type { DefineTriggerInput } from "./define-trigger.js";
export { defineTrigger } from "./define-trigger.js";
export type { ImportNodesResult } from "./dev-server/import-nodes.js";
export { importNodes } from "./dev-server/import-nodes.js";
export type { LoadedWorkflow, LoadedWorkspace } from "./dev-server/load.js";
// Dev server
export { loadWorkspace } from "./dev-server/load.js";
export type { MountOptions } from "./dev-server/server.js";
export { mountWorkflows } from "./dev-server/server.js";
export type { StartServerOptions } from "./dev-server/start.js";
export { startLorienServer } from "./dev-server/start.js";
export { NodeRunError, WorkflowError } from "./exec/errors.js";
export type { LifecycleEvent, LifecycleEventType } from "./exec/lifecycle.js";
export { LifecycleEmitter } from "./exec/lifecycle.js";
export type { RunWorkflowOptions, WorkflowRunResult } from "./exec/run.js";
// Execution
export { runWorkflow } from "./exec/run.js";
export type { ExecutionPlan } from "./exec/topology.js";
export { computeExecutionPlan } from "./exec/topology.js";
// Core types
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
} from "./types.js";
// Workflow file primitives
export {
  parseWorkflow,
  parseWorkflowFromString,
  WorkflowParseError,
} from "./workflow/parse.js";
export { parseReference, resolveInputValue } from "./workflow/reference.js";
export type {
  NodeInstance,
  NodeView,
  ParsedReference,
  ResolvedInputValue,
  WorkflowFile,
} from "./workflow/types.js";
export type { ValidationError, ValidationResult } from "./workflow/validate.js";
export { validateWorkflow } from "./workflow/validate.js";

export const VERSION = "0.0.0";
