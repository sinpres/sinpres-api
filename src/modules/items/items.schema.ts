import { z } from '@hono/zod-openapi'
import { paginationQuerySchema } from '../../shared/pagination'

const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}, z.boolean())

export const ItemSchema = z.object({
  id: z.number(),
  categoryId: z.number().nullable(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  stateCode: z.string().length(2).nullable(),
  referenceMonth: z.string().length(7).nullable(),
  isDesonerated: z.boolean().nullable(),
  unitPrice: z.number().nullable().describe('Preço em centavos (R$ × 100)'),
  technicalStandards: z.string().nullable(),
  generalInfo: z.string().nullable(),
  imageUrl: z.string().nullable(),
  metadata: z.any().nullable(),
  sourceUpdatedAt: z.string().nullable(),
  previousCode: z.number().nullable().openapi({
    example: null,
    description:
      'Código anterior deste insumo quando houve substituição publicada pela Caixa. Null se o código é original. Use para migrar registros locais quando o SINAPI substitui um código por outro.',
  }),
  createdAt: z.string(),
})

export const ItemCompactSchema = z.object({
  id: z.number(),
  categoryId: z.number().nullable(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  stateCode: z.string().length(2).nullable(),
  referenceMonth: z.string().length(7).nullable(),
  isDesonerated: z.boolean().nullable(),
  unitPrice: z.number().nullable().describe('Preço em centavos (R$ × 100)'),
  previousCode: z.number().nullable(),
})

export const ItemsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional().openapi({ example: 'tubo pvc', description: 'Termo de busca (full-text search em português)' }),
  unit: z.string().optional().openapi({ example: 'KG', description: 'Filtrar por unidade de medida' }),
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG). Não pode ser combinado com national=true.' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: booleanQuerySchema.default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
  compact: booleanQuerySchema.default(false).openapi({ example: false, description: 'Retorna payload reduzido para listagens de alta performance' }),
  national: booleanQuerySchema.default(false).openapi({ example: false, description: 'Retorna o preço médio nacional (ROUND(AVG) entre todas as UFs) em vez de filtrar por state. Não pode ser combinado com state.' }),
})

export const ItemDetailQuerySchema = z.object({
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG). Não pode ser combinado com national=true.' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: booleanQuerySchema.default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
  national: booleanQuerySchema.default(false).openapi({ example: false, description: 'Retorna o preço médio nacional (ROUND(AVG) entre todas as UFs) em vez de filtrar por state. Não pode ser combinado com state.' }),
})

export const ItemBulkQuerySchema = z.object({
  code: z.string().regex(/^\d+$/).openapi({ example: '34', description: 'Código SINAPI do insumo' }),
  state: z.string().length(2).transform((value) => value.toUpperCase()).openapi({ example: 'SP', description: 'UF de 2 letras' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: z.boolean().openapi({ example: false, description: 'Regime tributário' }),
})

export const ItemsBulkRequestSchema = z.object({
  queries: z.array(ItemBulkQuerySchema).max(100),
})

export const PaginationMetaSchema = z.object({
  total: z.number().nullable(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number().nullable(),
  hasNextPage: z.boolean(),
})

export const ItemsResponseSchema = z.object({
  data: z.array(z.union([ItemSchema, ItemCompactSchema])),
  meta: PaginationMetaSchema,
})

export const ItemResponseSchema = z.object({
  data: ItemSchema,
})

export const ItemsBulkResponseSchema = z.object({
  results: z.array(z.object({
    code: z.string(),
    found: z.boolean(),
    item: ItemSchema.optional(),
    reason: z.literal('no_price_for_coordinate').optional(),
  })),
})
