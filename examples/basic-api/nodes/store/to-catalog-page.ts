import { defineNode } from "@darrylondil/lorien-runtime"
import { z } from "zod"
import { petSchema } from "../../lib/schemas.js"

/** A pet as the client sees it: a display name and whether it can be ordered. */
const catalogItem = z.object({
  id: z.number(),
  name: z.string(),
  species: z.string(),
  status: z.string(),
  canOrder: z.boolean(),
})

const counts = z.object({ available: z.number(), pending: z.number(), sold: z.number() })

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default defineNode({
  name: "To Catalog Page",
  color: "pink",
  inputs: z.object({
    pets: z.array(petSchema),
    inventory: counts,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  }),
  outputs: z.object({
    page: z.object({
      items: z.array(catalogItem),
      page: z.number(),
      pageSize: z.number(),
      totalItems: z.number(),
      totalPages: z.number(),
      hasNextPage: z.boolean(),
      storeCounts: counts,
    }),
  }),
  /**
   * Shapes database rows into one page of the client's catalog. A pure
   * transform (a DTO mapper): it uses no providers, so its cases need no mocks.
   *
   * @param input - The matching pets, the store-wide counts, and which page to return.
   * @returns The page's items plus paging info and the store's counts by status.
   */
  async run({ pets, inventory, page, pageSize }) {
    const start = (page - 1) * pageSize
    const items = pets.slice(start, start + pageSize).map((p) => ({
      id: p.id,
      name: p.name,
      species: capitalize(p.species),
      status: p.status,
      canOrder: p.status === "available",
    }))
    return {
      page: {
        items,
        page,
        pageSize,
        totalItems: pets.length,
        totalPages: Math.max(1, Math.ceil(pets.length / pageSize)),
        hasNextPage: start + pageSize < pets.length,
        storeCounts: inventory,
      },
    }
  },
})
