import { z } from '@hono/zod-openapi'
import { paginationQuerySchema } from '../../shared/pagination'

export const CompositionItemSchema = z.object({
  itemType: z.enum(['INPUT', 'SUB_COMPOSITION']),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  resourceType: z.enum(['MATERIAL', 'LABOR', 'EQUIPMENT']).nullable(),
  coefficient: z.string(),
  unitPrice: z.number(),
  totalPrice: z.number(),
})

export const CompositionSchema = z.object({
  id: z.number(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  stateCode: z.string().length(2),
  referenceMonth: z.string().length(7),
  isDesonerated: z.boolean(),
  baseUnitCost: z.number(),
  sourceUpdatedAt: z.string().nullable(),
  previousCode: z.number().nullable().openapi({
    example: null,
    description:
      'Código anterior desta composição quando houve substituição publicada pela Caixa. Null se o código é original. Use para migrar registros locais quando o SINAPI substitui um código por outro.',
  }),
  createdAt: z.string(),
})

export const CompositionDetailSchema = CompositionSchema.extend({
  items: z.array(CompositionItemSchema),
})

export const CompositionsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional().openapi({ example: 'alvenaria', description: 'Termo de busca (full-text search em português)' }),
  unit: z.string().optional().openapi({ example: 'M2', description: 'Filtrar por unidade de medida' }),
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG)' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: z.coerce.boolean().default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
})

export const CompositionDetailQuerySchema = z.object({
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG)' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: z.coerce.boolean().default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
})

export const PaginationMetaSchema = z.object({
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
})

export const CompositionsResponseSchema = z.object({
  data: z.array(CompositionSchema),
  meta: PaginationMetaSchema,
})

export const CompositionResponseSchema = z.object({
  data: CompositionDetailSchema,
})
