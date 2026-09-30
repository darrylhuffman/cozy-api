import { z } from "zod"
import { PET_STATUSES } from "./db.js"

export const petStatusSchema = z.enum(PET_STATUSES)

export const petSchema = z.object({
  id: z.number(),
  name: z.string(),
  species: z.string(),
  status: petStatusSchema,
})

export const orderSchema = z.object({
  id: z.number(),
  petId: z.number(),
  quantity: z.number(),
  status: z.literal("placed"),
  placedAt: z.string(),
})

/** Path params and captured request variables arrive as strings. */
export const idSchema = z.coerce.number().int().positive()
