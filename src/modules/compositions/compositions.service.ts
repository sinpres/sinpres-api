import { db } from '../../db/client'
import {
  civilConstructionCompositionCatalog,
  civilConstructionCompositionPrices,
} from '../../db/schema'
import { eq, sql, and, count, desc, asc } from 'drizzle-orm'
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
    return { compositions: [], total: 0 }
  }

  const catalog = civilConstructionCompositionCatalog
  const conditions = []

  if (filter.unit) {
    conditions.push(eq(catalog.unit, filter.unit.toUpperCase()))
  }

  if (filter.search) {
    conditions.push(
      sql`to_tsvector('portuguese', ${catalog.description}) @@ plainto_tsquery('portuguese', ${filter.search})`
    )
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined
  const offset = (filter.page - 1) * filter.limit
  const includeTotal = filter.include_total !== false
  const queryLimit = includeTotal ? filter.limit : filter.limit + 1

  if (!filter.state) {
    const catalogQuery = db.select()
      .from(catalog)
      .where(where)
      .limit(queryLimit)
      .offset(offset)
      .orderBy(asc(catalog.code))

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
        total: null,
        hasNextPage,
      }
    }

    const [rows, totalResult] = await Promise.all([
      catalogQuery,
      db.select({ total: count() }).from(catalog).where(where),
    ])

    return {
      compositions: rows.map(mapCatalogComposition),
      total: totalResult[0].total,
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
    .orderBy(asc(catalog.code), asc(prices.stateCode))

  if (!includeTotal) {
    const rows = await compositionsQuery
    const hasNextPage = rows.length > filter.limit
    return { compositions: rows.slice(0, filter.limit), total: null, hasNextPage }
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
    total: totalResult[0].total,
    hasNextPage: filter.page * filter.limit < totalResult[0].total,
  }
}

export async function getCompositionByCode(schemaName: string, code: number, filter: { state?: string; month?: string; is_desonerated?: boolean }) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const catalog = civilConstructionCompositionCatalog
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
