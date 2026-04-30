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

interface ItemBulkQuery {
  code: string
  state: string
  month: string
  is_desonerated: boolean
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

export async function getItemByCode(schemaName: string, code: number, filter: { state?: string; month?: string; is_desonerated?: boolean }) {
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

export async function getItemsBulk(schemaName: string, queries: ItemBulkQuery[]) {
  if (schemaName !== 'civil_construction') {
    return queries.map((query) => ({
      code: query.code,
      found: false,
      reason: 'no_price_for_coordinate' as const,
    }))
  }

  if (queries.length === 0) {
    return []
  }

  const normalizedQueries = queries.map((query) => ({
    originalCode: query.code,
    code: Number(query.code),
    state: query.state.toUpperCase(),
    month: query.month,
    isDesonerated: query.is_desonerated,
  }))

  const uniqueQueries = Array.from(
    new Map(
      normalizedQueries.map((query) => [
        `${query.code}|${query.state}|${query.month}|${query.isDesonerated}`,
        query,
      ])
    ).values()
  )

  const tuples = uniqueQueries.map((query) => sql`(
    ${query.code},
    ${query.state},
    ${query.month},
    ${query.isDesonerated}
  )`)

  const raw = await db.execute<{
    id: number
    category_id: number | null
    code: number
    description: string
    unit: string
    state_code: string
    reference_month: string
    is_desonerated: boolean
    unit_price: number
    technical_standards: string | null
    general_info: string | null
    image_url: string | null
    metadata: unknown | null
    source_updated_at: string | null
    previous_code: number | null
    created_at: Date | string
  }>(sql`
    SELECT
      catalog.id,
      catalog.category_id,
      catalog.code,
      catalog.description,
      catalog.unit,
      prices.state_code,
      prices.reference_month,
      prices.is_desonerated,
      prices.unit_price,
      catalog.technical_standards,
      catalog.general_info,
      catalog.image_url,
      catalog.metadata,
      catalog.source_updated_at,
      catalog.previous_code,
      catalog.created_at
    FROM civil_construction.item_prices prices
    INNER JOIN civil_construction.item_catalog catalog
      ON catalog.id = prices.catalog_id
    WHERE (catalog.code, prices.state_code, prices.reference_month, prices.is_desonerated)
      IN (${sql.join(tuples, sql`, `)})
  `)

  const rows = ((raw as unknown as { rows?: unknown[] }).rows ?? (raw as unknown as unknown[])) as Array<{
    id: number
    category_id: number | null
    code: number
    description: string
    unit: string
    state_code: string
    reference_month: string
    is_desonerated: boolean
    unit_price: number
    technical_standards: string | null
    general_info: string | null
    image_url: string | null
    metadata: unknown | null
    source_updated_at: string | null
    previous_code: number | null
    created_at: Date | string
  }>

  const itemByCoordinate = new Map(rows.map((row) => [
    `${row.code}|${row.state_code}|${row.reference_month}|${row.is_desonerated}`,
    {
      id: row.id,
      categoryId: row.category_id,
      code: row.code,
      description: row.description,
      unit: row.unit,
      stateCode: row.state_code,
      referenceMonth: row.reference_month,
      isDesonerated: row.is_desonerated,
      unitPrice: row.unit_price,
      technicalStandards: row.technical_standards,
      generalInfo: row.general_info,
      imageUrl: row.image_url,
      metadata: row.metadata,
      sourceUpdatedAt: row.source_updated_at,
      previousCode: row.previous_code,
      createdAt: row.created_at,
    },
  ]))

  return normalizedQueries.map((query) => {
    const item = itemByCoordinate.get(`${query.code}|${query.state}|${query.month}|${query.isDesonerated}`)
    if (!item) {
      return {
        code: query.originalCode,
        found: false,
        reason: 'no_price_for_coordinate' as const,
      }
    }

    return {
      code: query.originalCode,
      found: true,
      item,
    }
  })
}
