// Helpers

// Built-ins
export {
  CORE_NODE_IDS,
  isCoreReference,
  resolveCoreNode,
} from "./core/registry.js"
export { defineConfig } from "./define-config.js"
export type { DefineNodeInput } from "./define-node.js"
export { defineNode } from "./define-node.js"
export type { DefineTriggerInput } from "./define-trigger.js"
export { defineTrigger } from "./define-trigger.js"
export { installConsoleCapture, withRunContext } from "./dev-server/console-capture.js"
export { isLoopbackOriginString } from "./dev-server/cors.js"
export type {
  Breakpoint,
  ClientMessage,
  RequestEnvelope,
  ServerMessage,
  WireLifecycleEvent,
} from "./dev-server/debug-protocol.js"
export { DebugSession } from "./dev-server/debug-session.js"
export type { AttachDebugWebSocketOptions } from "./dev-server/debug-ws.js"
export { attachDebugWebSocket } from "./dev-server/debug-ws.js"
export type { ImportNodesResult } from "./dev-server/import-nodes.js"
export { importNodes } from "./dev-server/import-nodes.js"
export type { LoadedWorkflow, LoadedWorkspace } from "./dev-server/load.js"
// Dev server
export { loadSubworkflows, loadWorkflowFile, loadWorkspace } from "./dev-server/load.js"
export { allowedMethods, answerUnmatchedWithJson } from "./dev-server/not-found.js"
export type {
  PreparedSchedule,
  RunningSchedules,
  ScheduleRunOptions,
} from "./dev-server/schedules.js"
export {
  mountScheduleRunner,
  prepareSchedules,
  RUN_SCHEDULE_PATH,
  SCHEDULE_METHOD,
  startWorkflowSchedules,
} from "./dev-server/schedules.js"
export type { DebugIntegration, MountOptions } from "./dev-server/server.js"
export { mountWorkflows } from "./dev-server/server.js"
export type { StartServerOptions } from "./dev-server/start.js"
export { startLorienServer } from "./dev-server/start.js"
export type { RequestIssue } from "./exec/errors.js"
export { NodeRunError, RequestValidationError, WorkflowError } from "./exec/errors.js"
export type { LifecycleEvent, LifecycleEventType } from "./exec/lifecycle.js"
export { LifecycleEmitter } from "./exec/lifecycle.js"
export type { RunWorkflowOptions, WorkflowRunResult } from "./exec/run.js"
// Execution
export { runWorkflow } from "./exec/run.js"
export type { ExecutionPlan } from "./exec/topology.js"
export { computeExecutionPlan } from "./exec/topology.js"
export type { DefineMiddlewareInput, Middleware } from "./middleware/define-middleware.js"
export { defineMiddleware, isMiddleware } from "./middleware/define-middleware.js"
export type { ImportMiddlewareResult, MiddlewareFile } from "./middleware/load.js"
export {
  findMiddlewareFiles,
  importMiddleware,
  MIDDLEWARE_FILE,
  middlewareChain,
} from "./middleware/load.js"
// Providers
export type {
  CreateProviderContainerOptions,
  ProviderContainer,
  ProviderScope,
} from "./providers/container.js"
export { createProviderContainer, readProviderEnvs } from "./providers/container.js"
export type {
  AnyProvider,
  DefineProviderInput,
  EnvSchema,
  ProvidedValue,
  Provider,
  ProviderCreateContext,
  ProviderLifetime,
} from "./providers/define-provider.js"
export {
  defineProvider,
  isProvider,
  SELECTOR_PATTERN,
  selectorProblem,
} from "./providers/define-provider.js"
export type {
  ImportProvidersResult,
  LoadProvidersOptions,
  ProviderFile,
  ScanProvidersResult,
} from "./providers/load.js"
export {
  findProviderFiles,
  importLegacyServices,
  importProviders,
  loadProviders,
  scanProviderFiles,
} from "./providers/load.js"
export type { ProviderPlan, ProviderPlanEntry } from "./providers/plan.js"
export { planProviders } from "./providers/plan.js"
// Services (legacy lorien.config.ts)
export { createServiceResolver } from "./services/resolve.js"
export type { ServiceResolver, ServicesConfig } from "./services/types.js"
// Core types
export type {
  AnyNodeOrTrigger,
  Disposable,
  MockProviders,
  Node,
  Providers,
  ServiceContext,
  Services,
  ServiceValue,
  TailwindColor,
  Trigger,
  WorkflowConfig,
  ZodObjectAny,
} from "./types.js"
export type { ParsedWhen } from "./workflow/dependencies.js"
export { dataDependencies, nodeDependencies, parseWhen } from "./workflow/dependencies.js"
export type { Subworkflow, SubworkflowMap } from "./workflow/flatten.js"
export {
  flattenWorkflow,
  referenceSource,
  SUBWORKFLOW_INPUT,
  SUBWORKFLOW_OUTPUT,
  SUBWORKFLOW_SEPARATOR,
  SubworkflowError,
  subworkflowPorts,
  subworkflowUses,
} from "./workflow/flatten.js"
// Workflow file primitives
export {
  parseWorkflow,
  parseWorkflowFromString,
  WorkflowParseError,
} from "./workflow/parse.js"
export { isReferenceString, parseReference } from "./workflow/reference.js"
export type { RouteConflict, WorkflowRoute } from "./workflow/routes.js"
export { defaultRoutePath, findRouteConflicts, workflowRoutes } from "./workflow/routes.js"
export type { WorkflowSchedule } from "./workflow/schedules.js"
export {
  DEFAULT_CRON,
  HTTP_TRIGGER,
  isTriggerUses,
  SCHEDULE_TRIGGER,
  scheduleProblems,
  TRIGGER_USES,
  workflowSchedules,
} from "./workflow/schedules.js"
export type {
  NodeInstance,
  NodeView,
  ParsedReference,
  WorkflowFile,
} from "./workflow/types.js"
export type { ValidationError, ValidationResult } from "./workflow/validate.js"
export { validateWorkflow } from "./workflow/validate.js"
export type { WiringIssue } from "./workflow/wiring.js"
export { checkWiring } from "./workflow/wiring.js"

export const VERSION = "0.0.0"
