import { db } from '../../db/client'
import {
  civilConstructionCompositionCatalog,
  civilConstructionCompositionPrices,
} from '../../db/schema'
import { eq, sql, and, count, desc, asc, type SQL } from 'drizzle-orm'
import type { PaginationQuery } from '../../shared/pagination'
import { remember } from '../../shared/memory-cache'

const METADATA_CACHE_TTL_MS = 5 * 60 * 1000

interface CompositionsFilter extends PaginationQuery {
  search?: string
  unit?: string
  state?: string
  month?: string
  is_desonerated?: boolean
  compact?: boolean
  national?: boolean
}

interface CompositionBulkQuery {
  code: string
  state: string
  month: string
  is_desonerated: boolean
}

interface ExpandedCompositionParams {
  slug: string
  code: number
  state: string
  month: string
  is_desonerated: boolean
  max_depth: number
}

interface ExpandedCompositionNode {
  code: string
  description: string
  unit: string | null
  depth: number
  coefficient: string | null
  item_type: 'COMPOSITION' | 'INPUT' | 'SUB_COMPOSITION'
  unit_price: number | null
  items: ExpandedCompositionNode[]
  truncated: boolean
}

export async function getLatestReferenceMonth(state?: string): Promise<string | null> {
  const normalizedState = state?.toUpperCase()

  return remember(`compositions:latest-reference-month:${normalizedState ?? '*'}`, METADATA_CACHE_TTL_MS, async () => {
    const prices = civilConstructionCompositionPrices
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

export async function getCompositions(schemaName: string, filter: CompositionsFilter) {
  if (schemaName !== 'civil_construction') {
    return { compositions: [], total: 0, hasNextPage: false }
  }

  const catalog = civilConstructionCompositionCatalog
  const offset = (filter.page - 1) * filter.limit
  const includeTotal = filter.include_total !== false
  const queryLimit = includeTotal ? filter.limit : filter.limit + 1
  const searchVector = sql`to_tsvector('portuguese_unaccent', ${catalog.description})`

  async function runListing(searchCondition: SQL | undefined, searchOrder: SQL | undefined): Promise<{ compositions: any[]; total: number | null; hasNextPage: boolean }> {
    const conditions = []

    if (filter.unit) {
      conditions.push(eq(catalog.unit, filter.unit.toUpperCase()))
    }

    if (searchCondition) {
      conditions.push(searchCondition)
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined

    if (filter.national) {
      const prices = civilConstructionCompositionPrices
      const isDesonerated = filter.is_desonerated ?? false
      const month = filter.month ?? (await getLatestReferenceMonth()) ?? undefined

      const avgConditions = [eq(prices.isDesonerated, isDesonerated)]
      if (month) avgConditions.push(eq(prices.referenceMonth, month))

      const avgPrices = db
        .select({
          catalogId: prices.catalogId,
          baseUnitCost: sql<number>`round(avg(${prices.baseUnitCost}))::int`.as('base_unit_cost'),
        })
        .from(prices)
        .where(and(...avgConditions))
        .groupBy(prices.catalogId)
        .as('avg_prices')

      const compactSelection = {
        id: catalog.id,
        code: catalog.code,
        description: catalog.description,
        unit: catalog.unit,
        baseUnitCost: avgPrices.baseUnitCost,
        previousCode: catalog.previousCode,
      }

      const fullSelection = {
        ...compactSelection,
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
          compositions: rows.slice(0, filter.limit).map(withNational),
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
        compositions: rows.map(withNational),
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

      const mapCatalogComposition = (row: typeof catalog.$inferSelect) => {
        const compactComposition = {
          id: row.id,
          code: row.code,
          description: row.description,
          unit: row.unit,
          stateCode: null,
          referenceMonth: null,
          isDesonerated: null,
          baseUnitCost: null,
          previousCode: row.previousCode,
        }

        if (filter.compact) return compactComposition

        return {
          ...compactComposition,
          sourceUpdatedAt: row.sourceUpdatedAt,
          createdAt: row.createdAt,
        }
      }

      if (!includeTotal) {
        const rows = await catalogQuery
        const hasNextPage = rows.length > filter.limit
        return {
          compositions: rows.slice(0, filter.limit).map(mapCatalogComposition),
          total: null as number | null,
          hasNextPage,
        }
      }

      const [rows, totalResult] = await Promise.all([
        catalogQuery,
        db.select({ total: count() }).from(catalog).where(where),
      ])

      return {
        compositions: rows.map(mapCatalogComposition),
        total: totalResult[0].total as number | null,
        hasNextPage: filter.page * filter.limit < totalResult[0].total,
      }
    }

    const prices = civilConstructionCompositionPrices
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
      code: catalog.code,
      description: catalog.description,
      unit: catalog.unit,
      stateCode: prices.stateCode,
      referenceMonth: prices.referenceMonth,
      isDesonerated: prices.isDesonerated,
      baseUnitCost: prices.baseUnitCost,
      previousCode: catalog.previousCode,
    }

    const fullSelection = {
      id: catalog.id,
      code: catalog.code,
      description: catalog.description,
      unit: catalog.unit,
      stateCode: prices.stateCode,
      referenceMonth: prices.referenceMonth,
      isDesonerated: prices.isDesonerated,
      baseUnitCost: prices.baseUnitCost,
      sourceUpdatedAt: catalog.sourceUpdatedAt,
      previousCode: catalog.previousCode,
      createdAt: catalog.createdAt,
    }
    const selection = filter.compact ? compactSelection : fullSelection

    const compositionsQuery = db.select(selection)
      .from(prices)
      .innerJoin(catalog, eq(prices.catalogId, catalog.id))
      .where(priceWhere)
      .limit(queryLimit)
      .offset(offset)
      .orderBy(...(searchOrder ? [searchOrder, asc(catalog.code), asc(prices.stateCode)] : [asc(catalog.code), asc(prices.stateCode)]))

    if (!includeTotal) {
      const rows = await compositionsQuery
      const hasNextPage = rows.length > filter.limit
      return { compositions: rows.slice(0, filter.limit), total: null as number | null, hasNextPage }
    }

    const [compositions, totalResult] = await Promise.all([
      compositionsQuery,
      db.select({ total: count() })
        .from(prices)
        .innerJoin(catalog, eq(prices.catalogId, catalog.id))
        .where(priceWhere),
    ])

    return {
      compositions,
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
      const prices = civilConstructionCompositionPrices
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

    const prices = civilConstructionCompositionPrices
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
    const empty = includeTotal ? result.total === 0 : result.compositions.length === 0
    if (!empty) return result

    // Without a total count, an empty page can mean either "zero FTS matches" or
    // "this offset is past the end of the FTS match set" — probe for any FTS match
    // (same condition, no offset/limit) before deciding the search truly missed.
    if (!includeTotal && (await probeMatch(ftsCondition))) {
      return result
    }

    // FTS miss (typo/variant) → trigram similarity fallback on description
    const trigramCondition = sql`similarity(${catalog.description}, ${filter.search}) > 0.25`
    const trigramOrder = sql`similarity(${catalog.description}, ${filter.search}) DESC`
    return runListing(trigramCondition, trigramOrder)
  }

  return runListing(undefined, undefined)
}

export async function getCompositionByCode(schemaName: string, code: number, filter: { state?: string; month?: string; is_desonerated?: boolean; national?: boolean }) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const catalog = civilConstructionCompositionCatalog

  if (filter.national) {
    const composition = (await db.select().from(catalog).where(eq(catalog.code, code)).limit(1))[0]
    if (!composition) return null

    const prices = civilConstructionCompositionPrices
    const isDesonerated = filter.is_desonerated ?? false
    const month = filter.month ?? (await getLatestReferenceMonth()) ?? undefined

    const avgConditions = [eq(prices.catalogId, composition.id), eq(prices.isDesonerated, isDesonerated)]
    if (month) avgConditions.push(eq(prices.referenceMonth, month))

    const avgResult = await db
      .select({ baseUnitCost: sql<number | null>`round(avg(${prices.baseUnitCost}))::int` })
      .from(prices)
      .where(and(...avgConditions))

    const baseUnitCost = avgResult[0]?.baseUnitCost ?? null
    if (baseUnitCost === null) return null // no cost for this code in any UF at this coordinate

    const referenceMonth = month ?? null

    // Same tree as the state branch, but each child's price is the national AVG at
    // this coordinate instead of a single UF's price. COALESCE 0 preserved.
    const itemsRaw = await db.execute<{
      item_type: 'INPUT' | 'SUB_COMPOSITION'
      item_code: number
      description: string
      unit: string
      resource_type: string | null
      coefficient: string
      unit_price: number
    }>(sql`
      SELECT
        ci.item_type,
        ci.item_code,
        ci.description,
        ci.unit,
        ci.resource_type,
        ci.coefficient::text AS coefficient,
        COALESCE(
          CASE
            WHEN ci.item_type = 'INPUT' THEN ip_avg.unit_price
            WHEN ci.item_type = 'SUB_COMPOSITION' THEN cp_avg.base_unit_cost
          END,
          0
        )::int AS unit_price
      FROM civil_construction.composition_items ci
      LEFT JOIN civil_construction.item_catalog ic
        ON ic.code = ci.item_code AND ci.item_type = 'INPUT'
      LEFT JOIN (
        SELECT catalog_id, AVG(unit_price) AS unit_price
        FROM civil_construction.item_prices
        WHERE reference_month = ${referenceMonth} AND is_desonerated = ${isDesonerated}
        GROUP BY catalog_id
      ) ip_avg ON ip_avg.catalog_id = ic.id
      LEFT JOIN civil_construction.composition_catalog cc
        ON cc.code = ci.item_code AND ci.item_type = 'SUB_COMPOSITION'
      LEFT JOIN (
        SELECT catalog_id, AVG(base_unit_cost) AS base_unit_cost
        FROM civil_construction.composition_prices
        WHERE reference_month = ${referenceMonth} AND is_desonerated = ${isDesonerated}
        GROUP BY catalog_id
      ) cp_avg ON cp_avg.catalog_id = cc.id
      WHERE ci.composition_id = ${composition.id}
      ORDER BY ci.item_code ASC
      LIMIT 1000
    `)

    const rows = (itemsRaw as unknown as { rows?: unknown[] }).rows ?? (itemsRaw as unknown as unknown[])
    const itemRows = rows as Array<{
      item_type: 'INPUT' | 'SUB_COMPOSITION'
      item_code: number
      description: string
      unit: string
      resource_type: string | null
      coefficient: string
      unit_price: number | string
    }>

    const items = itemRows.map((row) => {
      const unitPrice = Number(row.unit_price) || 0
      const coefficient = row.coefficient
      const totalPrice = Math.round(Number(coefficient) * unitPrice)
      return {
        itemType: row.item_type,
        code: row.item_code,
        description: row.description,
        unit: row.unit,
        resourceType: row.resource_type as 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | null,
        coefficient,
        unitPrice,
        totalPrice,
      }
    })

    return {
      id: composition.id,
      code: composition.code,
      description: composition.description,
      unit: composition.unit,
      stateCode: 'BR',
      referenceMonth,
      isDesonerated,
      baseUnitCost,
      sourceUpdatedAt: composition.sourceUpdatedAt,
      previousCode: composition.previousCode,
      createdAt: composition.createdAt,
      items,
    }
  }

  if (!filter.state) {
    const result = await db.select().from(catalog).where(eq(catalog.code, code)).limit(1)
    const composition = result[0]
    if (!composition) return null

    const itemsRaw = await db.execute<{
      item_type: 'INPUT' | 'SUB_COMPOSITION'
      item_code: number
      description: string
      unit: string
      resource_type: string | null
      coefficient: string
    }>(sql`
      SELECT
        ci.item_type,
        ci.item_code,
        ci.description,
        ci.unit,
        ci.resource_type,
        ci.coefficient::text AS coefficient
      FROM civil_construction.composition_items ci
      WHERE ci.composition_id = ${composition.id}
      ORDER BY ci.item_code ASC
      LIMIT 1000
    `)

    const rows = (itemsRaw as unknown as { rows?: unknown[] }).rows ?? (itemsRaw as unknown as unknown[])
    const itemRows = rows as Array<{
      item_type: 'INPUT' | 'SUB_COMPOSITION'
      item_code: number
      description: string
      unit: string
      resource_type: string | null
      coefficient: string
    }>

    return {
      id: composition.id,
      code: composition.code,
      description: composition.description,
      unit: composition.unit,
      stateCode: null,
      referenceMonth: null,
      isDesonerated: null,
      baseUnitCost: null,
      sourceUpdatedAt: composition.sourceUpdatedAt,
      previousCode: composition.previousCode,
      createdAt: composition.createdAt,
      items: itemRows.map((row) => ({
        itemType: row.item_type,
        code: row.item_code,
        description: row.description,
        unit: row.unit,
        resourceType: row.resource_type as 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | null,
        coefficient: row.coefficient,
        unitPrice: 0,
        totalPrice: 0,
      })),
    }
  }

  const prices = civilConstructionCompositionPrices
  const conditions = [eq(catalog.code, code), eq(prices.stateCode, filter.state.toUpperCase())]

  const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
  if (month) {
    conditions.push(eq(prices.referenceMonth, month))
  }

  const isDesonerated = filter.is_desonerated ?? false
  conditions.push(eq(prices.isDesonerated, isDesonerated))

  const where = and(...conditions)

  const selection = {
    id: catalog.id,
    code: catalog.code,
    description: catalog.description,
    unit: catalog.unit,
    stateCode: prices.stateCode,
    referenceMonth: prices.referenceMonth,
    isDesonerated: prices.isDesonerated,
    baseUnitCost: prices.baseUnitCost,
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

  const composition = result[0]
  if (!composition) return null

  const stateCode = composition.stateCode
  const referenceMonth = composition.referenceMonth

  const itemsRaw = await db.execute<{
    item_type: 'INPUT' | 'SUB_COMPOSITION'
    item_code: number
    description: string
    unit: string
    resource_type: string | null
    coefficient: string
    unit_price: number
  }>(sql`
    SELECT
      ci.item_type,
      ci.item_code,
      ci.description,
      ci.unit,
      ci.resource_type,
      ci.coefficient::text AS coefficient,
      COALESCE(
        CASE
          WHEN ci.item_type = 'INPUT' THEN ip.unit_price
          WHEN ci.item_type = 'SUB_COMPOSITION' THEN cp.base_unit_cost
        END,
        0
      )::int AS unit_price
    FROM civil_construction.composition_items ci
    LEFT JOIN civil_construction.item_catalog ic
      ON ic.code = ci.item_code AND ci.item_type = 'INPUT'
    LEFT JOIN civil_construction.item_prices ip
      ON ip.catalog_id = ic.id
     AND ip.state_code = ${stateCode}
     AND ip.reference_month = ${referenceMonth}
     AND ip.is_desonerated = ${isDesonerated}
    LEFT JOIN civil_construction.composition_catalog cc
      ON cc.code = ci.item_code AND ci.item_type = 'SUB_COMPOSITION'
    LEFT JOIN civil_construction.composition_prices cp
      ON cp.catalog_id = cc.id
     AND cp.state_code = ${stateCode}
     AND cp.reference_month = ${referenceMonth}
     AND cp.is_desonerated = ${isDesonerated}
    WHERE ci.composition_id = ${composition.id}
    ORDER BY ci.item_code ASC
    LIMIT 1000
  `)

  const rows = (itemsRaw as unknown as { rows?: unknown[] }).rows ?? (itemsRaw as unknown as unknown[])
  const itemRows = rows as Array<{
    item_type: 'INPUT' | 'SUB_COMPOSITION'
    item_code: number
    description: string
    unit: string
    resource_type: string | null
    coefficient: string
    unit_price: number | string
  }>

  const items = itemRows.map((row) => {
    const unitPrice = Number(row.unit_price) || 0
    const coefficient = row.coefficient
    const totalPrice = Math.round(Number(coefficient) * unitPrice)
    return {
      itemType: row.item_type,
      code: row.item_code,
      description: row.description,
      unit: row.unit,
      resourceType: row.resource_type as 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | null,
      coefficient,
      unitPrice,
      totalPrice,
    }
  })

  return {
    ...composition,
    items,
  }
}

export async function getCompositionsBulk(schemaName: string, queries: CompositionBulkQuery[]) {
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
    code: number
    description: string
    unit: string
    state_code: string
    reference_month: string
    is_desonerated: boolean
    base_unit_cost: number
    source_updated_at: string | null
    previous_code: number | null
    created_at: Date | string
  }>(sql`
    WITH requested(code, state_code, reference_month, is_desonerated) AS (
      VALUES ${sql.join(values, sql`, `)}
    )
    SELECT
      catalog.id,
      catalog.code,
      catalog.description,
      catalog.unit,
      prices.state_code,
      prices.reference_month,
      prices.is_desonerated,
      prices.base_unit_cost,
      catalog.source_updated_at,
      catalog.previous_code,
      catalog.created_at
    FROM requested
    INNER JOIN civil_construction.composition_catalog catalog
      ON catalog.code = requested.code
    INNER JOIN civil_construction.composition_prices prices
      ON prices.catalog_id = catalog.id
     AND prices.state_code = requested.state_code
     AND prices.reference_month = requested.reference_month
     AND prices.is_desonerated = requested.is_desonerated
  `)

  const rows = ((raw as unknown as { rows?: unknown[] }).rows ?? (raw as unknown as unknown[])) as Array<{
    id: number
    code: number
    description: string
    unit: string
    state_code: string
    reference_month: string
    is_desonerated: boolean
    base_unit_cost: number
    source_updated_at: string | null
    previous_code: number | null
    created_at: Date | string
  }>

  const compositionByCoordinate = new Map(rows.map((row) => [
    `${row.code}|${row.state_code}|${row.reference_month}|${row.is_desonerated}`,
    {
      id: row.id,
      code: row.code,
      description: row.description,
      unit: row.unit,
      stateCode: row.state_code,
      referenceMonth: row.reference_month,
      isDesonerated: row.is_desonerated,
      baseUnitCost: row.base_unit_cost,
      sourceUpdatedAt: row.source_updated_at,
      previousCode: row.previous_code,
      createdAt: row.created_at,
    },
  ]))

  return normalizedQueries.map((query) => {
    const composition = compositionByCoordinate.get(`${query.code}|${query.state}|${query.month}|${query.isDesonerated}`)
    if (!composition) {
      return {
        code: query.originalCode,
        found: false,
        reason: 'no_price_for_coordinate' as const,
      }
    }

    return {
      code: query.originalCode,
      found: true,
      composition,
    }
  })
}

export async function getExpandedComposition(params: ExpandedCompositionParams): Promise<ExpandedCompositionNode | null> {
  if (params.slug !== 'civil_construction') {
    return null
  }

  const maxDepth = Math.min(params.max_depth, 8)
  const state = params.state.toUpperCase()

  const raw = await db.execute<{
    node_key: string
    parent_key: string | null
    parent_code: string | null
    code: string
    description: string
    unit: string | null
    depth: number
    item_type: 'COMPOSITION' | 'INPUT' | 'SUB_COMPOSITION'
    coefficient: string | null
    unit_price: number | string | null
    has_sub_compositions: boolean
  }>(sql`
    WITH RECURSIVE tree AS (
      SELECT
        root.id AS composition_id,
        root.code::text AS node_key,
        NULL::text AS parent_key,
        NULL::text AS parent_code,
        root.code::text AS code,
        root.description,
        root.unit,
        0 AS depth,
        'COMPOSITION'::text AS item_type,
        NULL::text AS coefficient,
        root_price.base_unit_cost AS unit_price,
        EXISTS (
          SELECT 1
          FROM civil_construction.composition_items child
          WHERE child.composition_id = root.id
        ) AS has_sub_compositions
      FROM civil_construction.composition_catalog root
      LEFT JOIN civil_construction.composition_prices root_price
        ON root_price.catalog_id = root.id
       AND root_price.state_code = ${state}
       AND root_price.reference_month = ${params.month}
       AND root_price.is_desonerated = ${params.is_desonerated}
      WHERE root.code = ${params.code}

      UNION ALL

      SELECT
        child_composition.id AS composition_id,
        tree.node_key || '/' || child.item_type || ':' || child.item_code::text AS node_key,
        tree.node_key AS parent_key,
        tree.code AS parent_code,
        child.item_code::text AS code,
        CASE
          WHEN child.item_type = 'INPUT' THEN COALESCE(input_catalog.description, child.description)
          WHEN child.item_type = 'SUB_COMPOSITION' THEN COALESCE(child_composition.description, child.description)
          ELSE child.description
        END AS description,
        CASE
          WHEN child.item_type = 'INPUT' THEN COALESCE(input_catalog.unit, child.unit)
          WHEN child.item_type = 'SUB_COMPOSITION' THEN COALESCE(child_composition.unit, child.unit)
          ELSE child.unit
        END AS unit,
        tree.depth + 1 AS depth,
        child.item_type,
        child.coefficient::text AS coefficient,
        CASE
          WHEN child.item_type = 'INPUT' THEN input_price.unit_price
          WHEN child.item_type = 'SUB_COMPOSITION' THEN child_price.base_unit_cost
          ELSE NULL
        END AS unit_price,
        CASE
          WHEN child.item_type = 'SUB_COMPOSITION' AND child_composition.id IS NOT NULL THEN EXISTS (
            SELECT 1
            FROM civil_construction.composition_items grandchild
            WHERE grandchild.composition_id = child_composition.id
          )
          ELSE false
        END AS has_sub_compositions
      FROM tree
      INNER JOIN civil_construction.composition_items child
        ON child.composition_id = tree.composition_id
      LEFT JOIN civil_construction.item_catalog input_catalog
        ON input_catalog.code = child.item_code
       AND child.item_type = 'INPUT'
      LEFT JOIN civil_construction.item_prices input_price
        ON input_price.catalog_id = input_catalog.id
       AND input_price.state_code = ${state}
       AND input_price.reference_month = ${params.month}
       AND input_price.is_desonerated = ${params.is_desonerated}
      LEFT JOIN civil_construction.composition_catalog child_composition
        ON child_composition.code = child.item_code
       AND child.item_type = 'SUB_COMPOSITION'
      LEFT JOIN civil_construction.composition_prices child_price
        ON child_price.catalog_id = child_composition.id
       AND child_price.state_code = ${state}
       AND child_price.reference_month = ${params.month}
       AND child_price.is_desonerated = ${params.is_desonerated}
      WHERE tree.depth < ${maxDepth}
    )
    SELECT
      node_key,
      parent_key,
      parent_code,
      code,
      description,
      unit,
      depth,
      item_type,
      coefficient,
      unit_price,
      has_sub_compositions
    FROM tree
    ORDER BY node_key ASC
  `)

  const rows = ((raw as unknown as { rows?: unknown[] }).rows ?? (raw as unknown as unknown[])) as Array<{
    node_key: string
    parent_key: string | null
    parent_code: string | null
    code: string
    description: string
    unit: string | null
    depth: number
    item_type: 'COMPOSITION' | 'INPUT' | 'SUB_COMPOSITION'
    coefficient: string | null
    unit_price: number | string | null
    has_sub_compositions: boolean
  }>

  if (rows.length === 0) {
    return null
  }

  const nodesByKey = new Map<string, ExpandedCompositionNode>()
  for (const row of rows) {
    nodesByKey.set(row.node_key, {
      code: row.code,
      description: row.description,
      unit: row.unit,
      depth: row.depth,
      coefficient: row.coefficient,
      item_type: row.item_type,
      unit_price: row.unit_price === null ? null : Number(row.unit_price),
      items: [],
      truncated: row.depth >= maxDepth && row.has_sub_compositions,
    })
  }

  let root: ExpandedCompositionNode | null = null
  for (const row of rows) {
    const node = nodesByKey.get(row.node_key)
    if (!node) continue

    if (!row.parent_key) {
      root = node
      continue
    }

    const parent = nodesByKey.get(row.parent_key)
    parent?.items.push(node)
  }

  if (!root) {
    return null
  }

  function propagateTruncated(node: ExpandedCompositionNode): boolean {
    const childTruncated = node.items.some((item) => propagateTruncated(item))
    node.truncated = node.truncated || childTruncated
    return node.truncated
  }

  propagateTruncated(root)

  return root
}
