import { z } from '@hono/zod-openapi'

export const CategorySchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  createdAt: z.string(),
})

export const CategoriesResponseSchema = z.object({
  data: z.array(CategorySchema),
})
