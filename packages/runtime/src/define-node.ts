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
  /**
   * Optional accent color for IDE display. Free-form string — typically a
   * Tailwind/CSS color name ("blue", "rose", "amber") or a hex string
   * ("#a78bfa"). Has no runtime effect; pure metadata surfaced by the
   * workspace introspector and rendered as a thin accent stripe on the
   * node card in the workflow editor.
   */
  color?: string
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
