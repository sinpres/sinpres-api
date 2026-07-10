import { z } from '@hono/zod-openapi'
import { paginationQuerySchema } from '../../shared/pagination'

const booleanQuerySchema = z.preprocess((value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}, z.boolean())

export const CompositionItemSchema = z.object({
  itemType: z.enum(['INPUT', 'SUB_COMPOSITION']),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  resourceType: z.enum(['MATERIAL', 'LABOR', 'EQUIPMENT']).nullable(),
  coefficient: z.string(),
  unitPrice: z.number().describe('Preço em centavos (R$ × 100)'),
  totalPrice: z.number().describe('Preço em centavos (R$ × 100)'),
})

export const CompositionSchema = z.object({
  id: z.number(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  stateCode: z.string().length(2).nullable(),
  referenceMonth: z.string().length(7).nullable(),
  isDesonerated: z.boolean().nullable(),
  baseUnitCost: z.number().nullable().describe('Preço em centavos (R$ × 100)'),
  sourceUpdatedAt: z.string().nullable(),
  previousCode: z.number().nullable().openapi({
    example: null,
    description:
      'Código anterior desta composição quando houve substituição publicada pela Caixa. Null se o código é original. Use para migrar registros locais quando o SINAPI substitui um código por outro.',
  }),
  createdAt: z.string(),
})

export const CompositionCompactSchema = z.object({
  id: z.number(),
  code: z.number(),
  description: z.string(),
  unit: z.string(),
  stateCode: z.string().length(2).nullable(),
  referenceMonth: z.string().length(7).nullable(),
  isDesonerated: z.boolean().nullable(),
  baseUnitCost: z.number().nullable().describe('Preço em centavos (R$ × 100)'),
  previousCode: z.number().nullable(),
})

export const CompositionDetailSchema = CompositionSchema.extend({
  items: z.array(CompositionItemSchema),
})

export const CompositionsQuerySchema = paginationQuerySchema.extend({
  search: z.string().optional().openapi({ example: 'alvenaria', description: 'Termo de busca (full-text search em português)' }),
  unit: z.string().optional().openapi({ example: 'M2', description: 'Filtrar por unidade de medida' }),
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG). Não pode ser combinado com national=true.' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: booleanQuerySchema.default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
  compact: booleanQuerySchema.default(false).openapi({ example: false, description: 'Retorna payload reduzido para listagens de alta performance' }),
  national: booleanQuerySchema.default(false).openapi({ example: false, description: 'Retorna o custo médio nacional (ROUND(AVG) entre todas as UFs) em vez de filtrar por state. Não pode ser combinado com state.' }),
})

export const CompositionDetailQuerySchema = z.object({
  state: z.string().length(2).optional().openapi({ example: 'SP', description: 'UF de 2 letras (ex: SP, RJ, MG). Não pode ser combinado com national=true.' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional().openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: booleanQuerySchema.default(false).openapi({ example: false, description: 'Regime tributário: true = desonerado, false = não desonerado' }),
  national: booleanQuerySchema.default(false).openapi({ example: false, description: 'Retorna o custo médio nacional (ROUND(AVG) entre todas as UFs) em vez de filtrar por state. Não pode ser combinado com state.' }),
})

export const CompositionBulkQuerySchema = z.object({
  code: z.string().regex(/^\d+$/).openapi({ example: '7327', description: 'Código SINAPI da composição' }),
  state: z.string().length(2).transform((value) => value.toUpperCase()).openapi({ example: 'SP', description: 'UF de 2 letras' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: z.boolean().openapi({ example: false, description: 'Regime tributário' }),
})

export const CompositionsBulkRequestSchema = z.object({
  queries: z.array(CompositionBulkQuerySchema).max(100),
})

export const ExpandedCompositionQuerySchema = z.object({
  state: z.string().length(2).transform((value) => value.toUpperCase()).openapi({ example: 'SP', description: 'UF de 2 letras' }),
  month: z.string().regex(/^\d{4}-\d{2}$/).openapi({ example: '2026-03', description: 'Mês de referência no formato AAAA-MM' }),
  is_desonerated: booleanQuerySchema.openapi({ example: false, description: 'Regime tributário' }),
  max_depth: z.coerce.number().int().min(0).default(5).openapi({ example: 5, description: 'Profundidade máxima da árvore. Valores acima de 8 são limitados pelo servidor.' }),
})

export const ExpandedCompositionNodeSchema = z.object({
  code: z.string(),
  description: z.string(),
  unit: z.string().nullable(),
  depth: z.number(),
  coefficient: z.string().nullable(),
  item_type: z.enum(['COMPOSITION', 'INPUT', 'SUB_COMPOSITION']),
  unit_price: z.number().nullable().describe('Preço em centavos (R$ × 100)'),
  items: z.array(z.any()).openapi({ description: 'Nós filhos da composição expandida, com o mesmo formato do nó atual.' }),
  truncated: z.boolean(),
})

export const PaginationMetaSchema = z.object({
  total: z.number().nullable(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number().nullable(),
  hasNextPage: z.boolean(),
})

export const CompositionsResponseSchema = z.object({
  data: z.array(z.union([CompositionSchema, CompositionCompactSchema])),
  meta: PaginationMetaSchema,
})

export const CompositionResponseSchema = z.object({
  data: CompositionDetailSchema,
})

export const CompositionsBulkResponseSchema = z.object({
  results: z.array(z.object({
    code: z.string(),
    found: z.boolean(),
    composition: CompositionSchema.optional(),
    reason: z.literal('no_price_for_coordinate').optional(),
  })),
})

export const ExpandedCompositionResponseSchema = z.object({
  data: ExpandedCompositionNodeSchema,
})
