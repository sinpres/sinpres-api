import { db } from '../../db/client'
import { civilConstructionCompositions, civilConstructionCompositionItems } from '../../db/schema'
import { eq, sql, and, count, desc, asc } from 'drizzle-orm'
import type { PaginationQuery } from '../../shared/pagination'

interface CompositionsFilter extends PaginationQuery {
  search?: string
  unit?: string
  state?: string
  month?: string
  is_desonerated?: boolean
}

export async function getLatestReferenceMonth(state?: string): Promise<string | null> {
  const table = civilConstructionCompositions
  const conditions = []
  if (state) {
    conditions.push(eq(table.stateCode, state.toUpperCase()))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const result = await db
    .select({ referenceMonth: table.referenceMonth })
    .from(table)
    .where(where)
    .orderBy(desc(table.referenceMonth))
    .limit(1)

  return result[0]?.referenceMonth ?? null
}

export async function getCompositions(schemaName: string, filter: CompositionsFilter) {
  if (schemaName !== 'civil_construction') {
    return { compositions: [], total: 0 }
  }

  const table = civilConstructionCompositions
  const conditions = []

  if (filter.unit) {
    conditions.push(eq(table.unit, filter.unit.toUpperCase()))
  }

  if (filter.search) {
    conditions.push(
      sql`to_tsvector('portuguese', ${table.description}) @@ plainto_tsquery('portuguese', ${filter.search})`
    )
  }

  if (filter.state) {
    conditions.push(eq(table.stateCode, filter.state.toUpperCase()))
  }

  const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
  if (month) {
    conditions.push(eq(table.referenceMonth, month))
  }

  conditions.push(eq(table.isDesonerated, filter.is_desonerated ?? false))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const [compositions, totalResult] = await Promise.all([
    db.select()
      .from(table)
      .where(where)
      .limit(filter.limit)
      .offset(offset)
      .orderBy(asc(table.code), asc(table.stateCode)),
    db.select({ total: count() })
      .from(table)
      .where(where),
  ])

  return { compositions, total: totalResult[0].total }
}

export async function getCompositionByCode(schemaName: string, code: number, filter: { state?: string; month?: string; is_desonerated?: 'true' | 'false' }) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const table = civilConstructionCompositions
  const conditions = [eq(table.code, code)]

  if (filter.state) {
    conditions.push(eq(table.stateCode, filter.state.toUpperCase()))
  }

  const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
  if (month) {
    conditions.push(eq(table.referenceMonth, month))
  }

  conditions.push(eq(table.isDesonerated, filter.is_desonerated ?? false))

  const where = and(...conditions)

  const result = await db.select()
    .from(table)
    .where(where)
    .orderBy(desc(table.referenceMonth), asc(table.stateCode))
    .limit(1)

  const composition = result[0]
  if (!composition) return null

  const items = await db.select()
    .from(civilConstructionCompositionItems)
    .where(eq(civilConstructionCompositionItems.compositionId, composition.id))
    .orderBy(asc(civilConstructionCompositionItems.code))

  return {
    ...composition,
    items: items.map((item) => ({
      itemType: item.itemType as 'INPUT' | 'SUB_COMPOSITION',
      code: item.code,
      description: item.description,
      unit: item.unit,
      resourceType: item.resourceType as 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | null,
      coefficient: item.coefficient,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
    })),
  }
}
