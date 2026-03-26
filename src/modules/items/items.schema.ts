import { z } from '@hono/zod-openapi'
import { paginationQuerySchema } from '@/shared/pagination'

export const ItemSchema = z.object({
  id: z.number(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  technicalStandards: z.string().nullable(),
  generalInfo: z.string().nullable(),
  imageUrl: z.string().nullable(),
  metadata: z.any().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  createdAt: z.string(),
})

export const ItemsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional().openapi({ example: 'tubo pvc', description: 'Termo de busca (full-text search em português)' }),
  unit: z.string().optional().openapi({ example: 'KG', description: 'Filtrar por unidade de medida' }),
})

export const PaginationMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
})

export const ItemsResponseSchema = z.object({
  data: z.array(ItemSchema),
  meta: PaginationMetaSchema,
})

export const ItemResponseSchema = z.object({
  data: ItemSchema,
})
