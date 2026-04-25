import { db } from '../../db/client'
import {
  civilConstructionCompositionCatalog,
  civilConstructionCompositionPrices,
} from '../../db/schema'
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
  const prices = civilConstructionCompositionPrices
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

/**
 * Returns paginated compositions.
 * - When `state` is provided: joins with prices and returns one row per (code, state, month, regime).
 * - When `state` is omitted: returns the catalog only — one row per code, with stateCode/baseUnitCost null.
 */
export async function getCompositions(schemaName: string, filter: CompositionsFilter) {
  if (schemaName !== 'civil_construction') {
    return { compositions: [], total: 0 }
  }

  const catalog = civilConstructionCompositionCatalog

  // National mode — catalog only
  if (!filter.state) {
    const conditions = []
    if (filter.unit) conditions.push(eq(catalog.unit, filter.unit.toUpperCase()))
    if (filter.search) {
      conditions.push(
        sql`to_tsvector('portuguese', ${catalog.description}) @@ plainto_tsquery('portuguese', ${filter.search})`
      )
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined
    const offset = (filter.page - 1) * filter.limit

    const [rows, totalResult] = await Promise.all([
      db.select().from(catalog).where(where).limit(filter.limit).offset(offset).orderBy(asc(catalog.code)),
      db.select({ total: count() }).from(catalog).where(where),
    ])

    const compositions = rows.map((r) => ({
      id: r.id,
      code: r.code,
      description: r.description,
      unit: r.unit,
      stateCode: null as string | null,
      referenceMonth: null as string | null,
      isDesonerated: null as boolean | null,
      baseUnitCost: null as number | null,
      sourceUpdatedAt: r.sourceUpdatedAt,
      previousCode: r.previousCode,
      createdAt: r.createdAt,
    }))

    return { compositions, total: totalResult[0].total }
  }

  // State-filtered mode
  const prices = civilConstructionCompositionPrices
  const conditions = []

  if (filter.unit) conditions.push(eq(catalog.unit, filter.unit.toUpperCase()))
  if (filter.search) {
    conditions.push(
      sql`to_tsvector('portuguese', ${catalog.description}) @@ plainto_tsquery('portuguese', ${filter.search})`
    )
  }
  conditions.push(eq(prices.stateCode, filter.state.toUpperCase()))

  const month = filter.month ?? (await getLatestReferenceMonth(filter.state)) ?? undefined
  if (month) conditions.push(eq(prices.referenceMonth, month))

  conditions.push(eq(prices.isDesonerated, filter.is_desonerated ?? false))

  const where = and(...conditions)
  const offset = (filter.page - 1) * filter.limit

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

  const [compositions, totalResult] = await Promise.all([
    db.select(selection)
      .from(prices)
      .innerJoin(catalog, eq(prices.catalogId, catalog.id))
      .where(where)
      .limit(filter.limit)
      .offset(offset)
      .orderBy(asc(catalog.code)),
    db.select({ total: count() })
      .from(prices)
      .innerJoin(catalog, eq(prices.catalogId, catalog.id))
      .where(where),
  ])

  return { compositions, total: totalResult[0].total }
}

export async function getCompositionByCode(schemaName: string, code: number, filter: { state?: string; month?: string; is_desonerated?: 'true' | 'false' }) {
  if (schemaName !== 'civil_construction') {
    return null
  }

  const catalog = civilConstructionCompositionCatalog

  // No state filter -> return catalog row + composition_items with NO computed prices
  if (!filter.state) {
    const result = await db.select().from(catalog).where(eq(catalog.code, code)).limit(1)
    const r = result[0]
    if (!r) return null

    const itemsRaw = await db.execute<{
      item_type: 'INPUT' | 'SUB_COMPOSITION'
      item_code: number
      description: string
      unit: string
      resource_type: string | null
      coefficient: string
    }>(sql`
      SELECT ci.item_type, ci.item_code, ci.description, ci.unit, ci.resource_type, ci.coefficient::text AS coefficient
      FROM civil_construction.composition_items ci
      WHERE ci.composition_id = ${r.id}
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
      id: r.id,
      code: r.code,
      description: r.description,
      unit: r.unit,
      stateCode: null as string | null,
      referenceMonth: null as string | null,
      isDesonerated: null as boolean | null,
      baseUnitCost: null as number | null,
      sourceUpdatedAt: r.sourceUpdatedAt,
      previousCode: r.previousCode,
      createdAt: r.createdAt,
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
  if (month) conditions.push(eq(prices.referenceMonth, month))

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
    .orderBy(desc(prices.referenceMonth))
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
