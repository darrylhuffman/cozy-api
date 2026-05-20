import type { z } from "zod"
import type { Node, Services, ZodObjectAny } from "./types.js"

export interface DefineNodeInput<
  I extends ZodObjectAny,
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined,
> {
  name?: string
  inputs: I
  outputs: O
  config?: C
  run(
    input: z.infer<I>,
    services: Services,
    config: C extends ZodObjectAny ? z.infer<C> : undefined,
  ): Promise<z.infer<O>>
}

export function defineNode<
  I extends ZodObjectAny,
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined = undefined,
>(def: DefineNodeInput<I, O, C>): Node<I, O, C> {
  return {
    kind: "node",
    name: def.name,
    inputs: def.inputs,
    outputs: def.outputs,
    config: def.config,
    run: def.run,
  } as Node<I, O, C>
}
