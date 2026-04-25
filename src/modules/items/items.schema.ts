import { z } from '@hono/zod-openapi'
import { paginationQuerySchema } from '../../shared/pagination'

export const ItemSchema = z.object({
  id: z.number(),
  categoryId: z.number().nullable(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  stateCode: z.string().length(2),
  referenceMonth: z.string().length(7),
  isDesonerated: z.boolean(),
  unitPrice: z.number(),
  technicalStandards: z.string().nullable(),
  generalInfo: z.string().nullable(),
  imageUrl: z.string().nullable(),
  metadata: z.any().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  previousCode: z.number().nullable(),
  createdAt: z.string(),
})

export const ItemsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional().openapi({ example: 'tubo pvc', description: 'Termo de busca (full-text search em português)' }),
  unit: z.string().optional().openapi({ example: 'KG', description: 'Filtrar por unidade de medida' }),
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG)' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-04', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: z.coerce.boolean().default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
})

export const ItemDetailQuerySchema = z.object({
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG)' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-04', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: z.coerce.boolean().default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
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
