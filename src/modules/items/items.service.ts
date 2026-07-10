import { db } from '../../db/client'
import { civilConstructionItemCatalog, civilConstructionItemPrices } from '../../db/schema'
import { eq, sql, and, count, desc, asc, type SQL } from 'drizzle-orm'
import type { PaginationQuery } from '../../shared/pagination'
import { remember } from '../../shared/memory-cache'

const METADATA_CACHE_TTL_MS = 5 * 60 * 1000

interface ItemsFilter extends PaginationQuery {
  search?: string
  unit?: string
  state?: string
  month?: string
  is_desonerated?: boolean
  compact?: boolean
  national?: boolean
}

interface ItemBulkQuery {
  code: string
  state: string
  month: string
  is_desonerated: boolean
}

export async function getLatestReferenceMonth(state?: string): Promise<string | null> {
  const normalizedState = state?.toUpperCase()

  return remember(`items:latest-reference-month:${normalizedState ?? '*'}`, METADATA_CACHE_TTL_MS, async () => {
    const prices = civilConstructionItemPrices
    const conditions = []
    if (normalizedState) {
      conditions.push(eq(prices.stateCode, normalizedState))
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const result = await db
      .select({ referenceMonth: prices.referenceMonth })
      .from(prices)
      .where(where)
      .orderBy(desc(prices.referenceMonth))
      .limit(1)

    return result[0]?.referenceMonth ?? null
  })
}

export async function getItems(schemaName: string, filter: ItemsFilter) {
  if (schemaName !== 'civil_construction') {
    return { items: [], total: 0, hasNextPage: false }
  }

  const catalog = civilConstructionItemCatalog
  const offset = (filter.page - 1) * filter.limit
  const includeTotal = filter.include_total !== false
  const queryLimit = includeTotal ? filter.limit : filter.limit + 1
  const searchVector = sql`to_tsvector('portuguese_unaccent', ${catalog.description} || ' ' || coalesce(${catalog.generalInfo}, ''))`

  async function runListing(searchCondition: SQL | undefined, searchOrder: SQL | undefined): Promise<{ items: any[]; total: number | null; hasNextPage: boolean }> {
    const conditions = []

    if (filter.unit) {
      conditions.push(eq(catalog.unit, filter.unit.toUpperCase()))
    }

    if (searchCondition) {
      conditions.push(searchCondition)
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    if (filter.national) {
      const prices = civilConstructionItemPrices
      const isDesonerated = filter.is_desonerated ?? false
      const month = filter.month ?? (await getLatestReferenceMonth()) ?? undefined

      const avgConditions = [eq(prices.isDesonerated, isDesonerated)]
      if (month) avgConditions.push(eq(prices.referenceMonth, month))

      const avgPrices = db
        .select({
          catalogId: prices.catalogId,
          unitPrice: sql<number>`round(avg(${prices.unitPrice}))::int`.as('unit_price'),
        })
        .from(prices)
        .where(and(...avgConditions))
        .groupBy(prices.catalogId)
        .as('avg_prices')

      const compactSelection = {
        id: catalog.id,
        categoryId: catalog.categoryId,
        code: catalog.code,
        description: catalog.description,
        unit: catalog.unit,
        unitPrice: avgPrices.unitPrice,
        previousCode: catalog.previousCode,
      }

      const fullSelection = {
        ...compactSelection,
        technicalStandards: catalog.technicalStandards,
        generalInfo: catalog.generalInfo,
        imageUrl: catalog.imageUrl,
        metadata: catalog.metadata,
        sourceUpdatedAt: catalog.sourceUpdatedAt,
        createdAt: catalog.createdAt,
      }
      const selection = filter.compact ? compactSelection : fullSelection

      const withNational = <T extends Record<string, unknown>>(row: T) => ({
        ...row,
        stateCode: 'BR' as const,
        referenceMonth: month ?? null,
        isDesonerated,
      })

      const nationalQuery = db.select(selection)
        .from(avgPrices)
        .innerJoin(catalog, eq(avgPrices.catalogId, catalog.id))
        .where(where)
        .limit(queryLimit)
        .offset(offset)
        .orderBy(...(searchOrder ? [searchOrder, asc(catalog.code)] : [asc(catalog.code)]))

      if (!includeTotal) {
        const rows = await nationalQuery
        const hasNextPage = rows.length > filter.limit
        return {
          items: rows.slice(0, filter.limit).map(withNational),
          total: null as number | null,
          hasNextPage,
        }
      }

      const [rows, totalResult] = await Promise.all([
        nationalQuery,
        db.select({ total: count() })
          .from(avgPrices)
          .innerJoin(catalog, eq(avgPrices.catalogId, catalog.id))
          .where(where),
      ])

      return {
        items: rows.map(withNational),
        total: totalResult[0].total as number | null,
        hasNextPage: filter.page * filter.limit < totalResult[0].total,
      }
    }

    if (!filter.state) {
      const catalogQuery = db.select()
        .from(catalog)
        .where(where)
        .limit(queryLimit)
        .offset(offset)
        .orderBy(...(searchOrder ? [searchOrder, asc(catalog.code)] : [asc(catalog.code)]))

      const mapCatalogItem = (row: typeof catalog.$inferSelect) => {
        const compactItem = {
          id: row.id,
          categoryId: row.categoryId,
          code: row.code,
          description: row.description,
          unit: row.unit,
          stateCode: null,
          referenceMonth: null,
          isDesonerated: null,
          unitPrice: null,
          previousCode: row.previousCode,
        }

        if (filter.compact) return compactItem

        return {
          ...compactItem,
          technicalStandards: row.technicalStandards,
          generalInfo: row.generalInfo,
          imageUrl: row.imageUrl,
          metadata: row.metadata,
          sourceUpdatedAt: row.sourceUpdatedAt,
          createdAt: row.createdAt,
        }
      }

      if (!includeTotal) {
        const rows = await catalogQuery
        const hasNextPage = rows.length > filter.limit
        return {
          items: rows.slice(0, filter.limit).map(mapCatalogItem),
          total: null as number | null,
          hasNextPage,
        }
      }

      const [rows, totalResult] = await Promise.all([
        catalogQuery,
        db.select({ total: count() }).from(catalog).where(where),
      ])

      return {
        items: rows.map(mapCatalogItem),
        total: totalResult[0].total as number | null,
        hasNextPage: filter.page * filter.limit < totalResult[0].total,
      }
    }

    const prices = civilConstructionItemPrices
    const priceConditions = [
      ...conditions,
      eq(prices.stateCode, filter.state.toUpperCase()),
    ]

    const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
    if (month) {
      priceConditions.push(eq(prices.referenceMonth, month))
    }

    priceConditions.push(eq(prices.isDesonerated, filter.is_desonerated ?? false))

    const priceWhere = and(...priceConditions)

    const compactSelection = {
      id: catalog.id,
      categoryId: catalog.categoryId,
      code: catalog.code,
      description: catalog.description,
      unit: catalog.unit,
      stateCode: prices.stateCode,
      referenceMonth: prices.referenceMonth,
      isDesonerated: prices.isDesonerated,
      unitPrice: prices.unitPrice,
      previousCode: catalog.previousCode,
    }

    const fullSelection = {
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
    const selection = filter.compact ? compactSelection : fullSelection

    const itemsQuery = db.select(selection)
      .from(prices)
      .innerJoin(catalog, eq(prices.catalogId, catalog.id))
      .where(priceWhere)
      .limit(queryLimit)
      .offset(offset)
      .orderBy(...(searchOrder ? [searchOrder, asc(catalog.code), asc(prices.stateCode)] : [asc(catalog.code), asc(prices.stateCode)]))

    if (!includeTotal) {
      const rows = await itemsQuery
      const hasNextPage = rows.length > filter.limit
      return { items: rows.slice(0, filter.limit), total: null as number | null, hasNextPage }
    }

    const [items, totalResult] = await Promise.all([
      itemsQuery,
      db.select({ total: count() })
        .from(prices)
        .innerJoin(catalog, eq(prices.catalogId, catalog.id))
        .where(priceWhere),
    ])

    return {
      items,
      total: totalResult[0].total as number | null,
      hasNextPage: filter.page * filter.limit < totalResult[0].total,
    }
  }

  // Cheap existence check for a search condition, ignoring offset/limit/order. Mirrors
  // runListing's branch dispatch (national / catalog-only / state) so it matches the
  // exact same row set the listing query would draw from.
  // ponytail: duplicates runListing's per-branch where-building instead of refactoring
  // runListing to expose it, to keep this a zero-risk addition to the existing 3 branches.
  // If those branches' filters change, mirror the change here too.
  async function probeMatch(searchCondition: SQL): Promise<boolean> {
    const conditions: SQL[] = [searchCondition]
    if (filter.unit) {
      conditions.push(eq(catalog.unit, filter.unit.toUpperCase()))
    }
    const where = and(...conditions)

    if (filter.national) {
      const prices = civilConstructionItemPrices
      const isDesonerated = filter.is_desonerated ?? false
      const month = filter.month ?? (await getLatestReferenceMonth()) ?? undefined

      const avgConditions = [eq(prices.isDesonerated, isDesonerated)]
      if (month) avgConditions.push(eq(prices.referenceMonth, month))

      const avgPrices = db
        .select({ catalogId: prices.catalogId })
        .from(prices)
        .where(and(...avgConditions))
        .groupBy(prices.catalogId)
        .as('avg_prices')

      const rows = await db.select({ id: catalog.id })
        .from(avgPrices)
        .innerJoin(catalog, eq(avgPrices.catalogId, catalog.id))
        .where(where)
        .limit(1)
      return rows.length > 0
    }

    if (!filter.state) {
      const rows = await db.select({ id: catalog.id }).from(catalog).where(where).limit(1)
      return rows.length > 0
    }

    const prices = civilConstructionItemPrices
    const priceConditions = [
      ...conditions,
      eq(prices.stateCode, filter.state.toUpperCase()),
    ]

    const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
    if (month) {
      priceConditions.push(eq(prices.referenceMonth, month))
    }
    priceConditions.push(eq(prices.isDesonerated, filter.is_desonerated ?? false))

    const rows = await db.select({ id: catalog.id })
      .from(prices)
      .innerJoin(catalog, eq(prices.catalogId, catalog.id))
      .where(and(...priceConditions))
      .limit(1)
    return rows.length > 0
  }

  if (filter.search) {
    const ftsCondition = sql`${searchVector} @@ plainto_tsquery('portuguese_unaccent', ${filter.search})`
    const ftsOrder = sql`ts_rank(${searchVector}, plainto_tsquery('portuguese_unaccent', ${filter.search})) DESC`
    const result = await runListing(ftsCondition, ftsOrder)
    const empty = includeTotal ? result.total === 0 : result.items.length === 0
    if (!empty) return result

    // Without a total count, an empty page can mean either "zero FTS matches" or
    // "this offset is past the end of the FTS match set" — probe for any FTS match
    // (same condition, no offset/limit) before deciding the search truly missed.
    if (!includeTotal && (await probeMatch(ftsCondition))) {
      return result
    }

    // FTS miss (typo/variant) → trigram fallback on description. word_similarity
    // (query vs best-matching word) instead of whole-string similarity: real
    // catalog descriptions are long, so whole-string similarity for a one-word
    // typo never clears any useful threshold (~0.1 vs 0.5 for word_similarity).
    const trigramCondition = sql`word_similarity(${filter.search}, ${catalog.description}) > 0.4`
    const trigramOrder = sql`word_similarity(${filter.search}, ${catalog.description}) DESC`
    return runListing(trigramCondition, trigramOrder)
  }

  return runListing(undefined, undefined)
}

export async function getItemByCode(schemaName: string, code: number, filter: { state?: string; month?: string; is_desonerated?: boolean; national?: boolean }) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const catalog = civilConstructionItemCatalog

  if (filter.national) {
    const item = (await db.select().from(catalog).where(eq(catalog.code, code)).limit(1))[0]
    if (!item) return null

    const prices = civilConstructionItemPrices
    const isDesonerated = filter.is_desonerated ?? false
    const month = filter.month ?? (await getLatestReferenceMonth()) ?? undefined

    const avgConditions = [eq(prices.catalogId, item.id), eq(prices.isDesonerated, isDesonerated)]
    if (month) avgConditions.push(eq(prices.referenceMonth, month))

    const avgResult = await db
      .select({ unitPrice: sql<number | null>`round(avg(${prices.unitPrice}))::int` })
      .from(prices)
      .where(and(...avgConditions))

    const unitPrice = avgResult[0]?.unitPrice ?? null
    if (unitPrice === null) return null // no price for this code in any UF at this coordinate

    return {
      id: item.id,
      categoryId: item.categoryId,
      code: item.code,
      description: item.description,
      unit: item.unit,
      stateCode: 'BR',
      referenceMonth: month ?? null,
      isDesonerated,
      unitPrice,
      technicalStandards: item.technicalStandards,
      generalInfo: item.generalInfo,
      imageUrl: item.imageUrl,
      metadata: item.metadata,
      sourceUpdatedAt: item.sourceUpdatedAt,
      previousCode: item.previousCode,
      createdAt: item.createdAt,
    }
  }

  if (!filter.state) {
    const result = await db.select().from(catalog).where(eq(catalog.code, code)).limit(1)
    const item = result[0]
    if (!item) return null

    return {
      id: item.id,
      categoryId: item.categoryId,
      code: item.code,
      description: item.description,
      unit: item.unit,
      stateCode: null,
      referenceMonth: null,
      isDesonerated: null,
      unitPrice: null,
      technicalStandards: item.technicalStandards,
      generalInfo: item.generalInfo,
      imageUrl: item.imageUrl,
      metadata: item.metadata,
      sourceUpdatedAt: item.sourceUpdatedAt,
      previousCode: item.previousCode,
      createdAt: item.createdAt,
    }
  }

  const prices = civilConstructionItemPrices
  const conditions = [eq(catalog.code, code), eq(prices.stateCode, filter.state.toUpperCase())]

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

  const values = uniqueQueries.map((query) => sql`(
    ${query.code}::integer,
    ${query.state}::varchar(2),
    ${query.month}::varchar(7),
    ${query.isDesonerated}::boolean
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
    WITH requested(code, state_code, reference_month, is_desonerated) AS (
      VALUES ${sql.join(values, sql`, `)}
    )
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
    FROM requested
    INNER JOIN civil_construction.item_catalog catalog
      ON catalog.code = requested.code
    INNER JOIN civil_construction.item_prices prices
      ON prices.catalog_id = catalog.id
     AND prices.state_code = requested.state_code
     AND prices.reference_month = requested.reference_month
     AND prices.is_desonerated = requested.is_desonerated
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
