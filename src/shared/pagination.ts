import { z } from '@hono/zod-openapi'

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).openapi({ example: 1, description: 'Número da página' }),
  limit: z.coerce.number().int().min(1).max(100).default(50).openapi({ example: 50, description: 'Itens por página (máx. 100)' }),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export function paginationMeta(total: number, page: number, limit: number) {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  }
}

export function paginationOffset(page: number, limit: number) {
  return (page - 1) * limit
}
