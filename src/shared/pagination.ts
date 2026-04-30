import { z } from '@hono/zod-openapi'

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).openapi({ example: 1, description: 'Número da página' }),
  limit: z.coerce.number().int().min(1).max(100).default(50).openapi({ example: 50, description: 'Itens por página (máx. 100)' }),
  include_total: z.preprocess((value) => {
    if (value === 'true') return true
    if (value === 'false') return false
    return value
  }, z.boolean()).default(true).openapi({ example: true, description: 'Inclui total e totalPages na paginação. Use false para evitar COUNT(*) em listagens grandes.' }),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export function paginationMeta(total: number | null, page: number, limit: number, hasNextPage?: boolean) {
  const meta = {
    total,
    page,
    limit,
    totalPages: total === null ? null : Math.ceil(total / limit),
    hasNextPage: hasNextPage ?? (total === null ? false : page * limit < total),
  }

  return meta
}

export function paginationOffset(page: number, limit: number) {
  return (page - 1) * limit
}
