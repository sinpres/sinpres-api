import { z } from '@hono/zod-openapi'

export const SectorSchema = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  schemaName: z.string(),
  createdAt: z.string(),
})

export const SectorsResponseSchema = z.object({
  data: z.array(SectorSchema),
})

export const SectorResponseSchema = z.object({
  data: SectorSchema,
})
