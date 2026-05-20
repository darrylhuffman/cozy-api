import type { Trigger, ZodObjectAny } from "./types.js"

export interface DefineTriggerInput<O extends ZodObjectAny, C extends ZodObjectAny | undefined> {
  name?: string
  outputs: O
  config?: C
}

export function defineTrigger<
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined = undefined,
>(def: DefineTriggerInput<O, C>): Trigger<O, C> {
  return {
    kind: "trigger",
    name: def.name,
    outputs: def.outputs,
    config: def.config,
  } as Trigger<O, C>
}
