import { db } from '../../db/client'
import { civilConstructionItemCatalog, civilConstructionItemPrices } from '../../db/schema'
import { eq, sql, and, count, desc, asc } from 'drizzle-orm'
import type { PaginationQuery } from '../../shared/pagination'

interface ItemsFilter extends PaginationQuery {
  search?: string
  unit?: string
  state?: string
  month?: string
  is_desonerated?: boolean
}

export async function getLatestReferenceMonth(state?: string): Promise<string | null> {
  const prices = civilConstructionItemPrices
  const conditions = []
  if (state) {
    conditions.push(eq(prices.stateCode, state.toUpperCase()))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const result = await db
    .select({ referenceMonth: prices.referenceMonth })
    .from(prices)
    .where(where)
    .orderBy(desc(prices.referenceMonth))
    .limit(1)

  return result[0]?.referenceMonth ?? null
}

export async function getItems(schemaName: string, filter: ItemsFilter) {
  if (schemaName !== 'civil_construction') {
    return { items: [], total: 0 }
  }

  const catalog = civilConstructionItemCatalog
  const prices = civilConstructionItemPrices
  const conditions = []

  if (filter.unit) {
    conditions.push(eq(catalog.unit, filter.unit.toUpperCase()))
  }

  if (filter.search) {
    conditions.push(
      sql`to_tsvector('portuguese', ${catalog.description} || ' ' || coalesce(${catalog.generalInfo}, '')) @@ plainto_tsquery('portuguese', ${filter.search})`
    )
  }

  if (filter.state) {
    conditions.push(eq(prices.stateCode, filter.state.toUpperCase()))
  }

  const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
  if (month) {
    conditions.push(eq(prices.referenceMonth, month))
  }

  conditions.push(eq(prices.isDesonerated, filter.is_desonerated ?? false))

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit

  const selection = {
    id: catalog.id,
    categoryId: catalog.categoryId,
    code: catalog.code,
    description: catalog.description,
    unit: catalog.unit,
    stateCode: prices.stateCode,
    referenceMonth: prices.referenceMonth,
    isDesonerated: prices.isDesonerated,
    unitPrice: prices.unitPrice,
    technicalStandards: catalog.technicalStandards,
    generalInfo: catalog.generalInfo,
    imageUrl: catalog.imageUrl,
    metadata: catalog.metadata,
    sourceUpdatedAt: catalog.sourceUpdatedAt,
    previousCode: catalog.previousCode,
    createdAt: catalog.createdAt,
  }

  const [items, totalResult] = await Promise.all([
    db.select(selection)
      .from(prices)
      .innerJoin(catalog, eq(prices.catalogId, catalog.id))
      .where(where)
      .limit(filter.limit)
      .offset(offset)
      .orderBy(asc(catalog.code), asc(prices.stateCode)),
    db.select({ total: count() })
      .from(prices)
      .innerJoin(catalog, eq(prices.catalogId, catalog.id))
      .where(where),
  ])

  return { items, total: totalResult[0].total }
}

export async function getItemByCode(schemaName: string, code: number, filter: { state?: string; month?: string; is_desonerated?: 'true' | 'false' }) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const catalog = civilConstructionItemCatalog
  const prices = civilConstructionItemPrices
  const conditions = [eq(catalog.code, code)]

  if (filter.state) {
    conditions.push(eq(prices.stateCode, filter.state.toUpperCase()))
  }

  const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
  if (month) {
    conditions.push(eq(prices.referenceMonth, month))
  }

  conditions.push(eq(prices.isDesonerated, filter.is_desonerated ?? false))

  const where = and(...conditions)

  const selection = {
    id: catalog.id,
    categoryId: catalog.categoryId,
    code: catalog.code,
    description: catalog.description,
    unit: catalog.unit,
    stateCode: prices.stateCode,
    referenceMonth: prices.referenceMonth,
    isDesonerated: prices.isDesonerated,
    unitPrice: prices.unitPrice,
    technicalStandards: catalog.technicalStandards,
    generalInfo: catalog.generalInfo,
    imageUrl: catalog.imageUrl,
    metadata: catalog.metadata,
    sourceUpdatedAt: catalog.sourceUpdatedAt,
    previousCode: catalog.previousCode,
    createdAt: catalog.createdAt,
  }

  const result = await db.select(selection)
    .from(prices)
    .innerJoin(catalog, eq(prices.catalogId, catalog.id))
    .where(where)
    .orderBy(desc(prices.referenceMonth), asc(prices.stateCode))
    .limit(1)

  return result[0] ?? null
}
