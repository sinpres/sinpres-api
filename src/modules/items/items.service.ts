import { db } from '@/db/client'
import { civilConstructionItems } from '@/db/schema'
import { eq, sql, and, count } from 'drizzle-orm'
import type { PaginationQuery } from '@/shared/pagination'

interface ItemsFilter extends PaginationQuery {
  search?: string
  unit?: string
}

export async function getItems(schemaName: string, filter: ItemsFilter) {
  if (schemaName !== 'civil_construction') {
    return { items: [], total: 0 }
  }

  const table = civilConstructionItems
  const conditions = []

  if (filter.unit) {
    conditions.push(eq(table.unit, filter.unit))
  }

  if (filter.search) {
    conditions.push(
      sql`to_tsvector('portuguese', ${table.description} || ' ' || coalesce(${table.generalInfo}, '')) @@ plainto_tsquery('portuguese', ${filter.search})`
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const [items, totalResult] = await Promise.all([
    db.select()
      .from(table)
      .where(where)
      .limit(filter.limit)
      .offset(offset)
      .orderBy(table.code),
    db.select({ total: count() })
      .from(table)
      .where(where),
  ])

  return { items, total: totalResult[0].total }
}

export async function getItemByCode(schemaName: string, code: number) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const result = await db.select()
    .from(civilConstructionItems)
    .where(eq(civilConstructionItems.code, code))

  return result[0] ?? null
}
