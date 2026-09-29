import type { z } from "zod"
import type { Node, Services, TailwindColor, ZodObjectAny } from "./types.js"

export interface DefineNodeInput<
  I extends ZodObjectAny,
  O extends ZodObjectAny,
  C extends ZodObjectAny | undefined,
> {
  name?: string
  inputs: I
  outputs: O
  config?: C
  /**
   * Optional accent color for IDE display. One of the Tailwind palette names
   * ("amber", "rose", "indigo", ...) — the IDE resolves it to the 500-weight
   * hex value and renders a thin stripe on the node card. No runtime effect.
   */
  color?: TailwindColor
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
    color: def.color,
    run: def.run,
  } as Node<I, O, C>
}
