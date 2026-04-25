/**
 * SINAPI reference importer — consumes JSONs produced by sinapi-extractor.
 *
 * Reads the JSON bundle from sinapi-extractor's `output/reference/` directory and
 * upserts the five dimensional tables. No XLSX parsing happens here — that lives
 * entirely in the Python extractor (sinapi-extractor/src/extract_reference.py).
 *
 * Expected bundle layout:
 *   <referenceDir>/
 *     metadata.json              { reference_month, generated_at, source_file }
 *     items_catalog.json         [{ code, description, unit }]
 *     items_prices.json          [{ code, state_code, reference_month, is_desonerated, unit_price }]
 *     compositions_catalog.json  [{ code, description, unit }]
 *     compositions_prices.json   [{ code, state_code, reference_month, is_desonerated, base_unit_cost }]
 *     composition_items.json     [{ composition_code, item_type, item_code, description, unit, coefficient }]
 *
 * Catalog upserts are SCD Type 1 — when description or unit diverge from the existing
 * row, a structured WARNING is logged before the values are overwritten. Prices and
 * composition_items are upserted with conflict resolution that allows re-importing
 * the same reference month idempotently to correct values.
 *
 * Fields not populated here:
 *   - previous_code      -> populated by maintenances.ts
 *   - image_url, technical_standards, general_info, source_updated_at
 *                        -> populated by enrich-from-extractor.ts
 *   - resource_type      -> left null (XLSX does not expose it cleanly)
 */

import { db } from '../client'
import {
  itemCatalog, itemPrices, compositionCatalog, compositionPrices, compositionItems,
} from '../schema/civil-construction'
import { sql, eq } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { resolve, join } from 'path'

interface ItemCatalogJson { code: number; description: string; unit: string }
interface ItemPriceJson {
  code: number
  state_code: string
  reference_month: string
  is_desonerated: boolean
  unit_price: number
}
interface CompositionCatalogJson { code: number; description: string; unit: string }
interface CompositionPriceJson {
  code: number
  state_code: string
  reference_month: string
  is_desonerated: boolean
  base_unit_cost: number
}
interface CompositionItemJson {
  composition_code: number
  item_type: 'INPUT' | 'SUB_COMPOSITION'
  item_code: number
  description: string
  unit: string
  coefficient: string
}

interface CatalogStats { newCodes: number; unchanged: number; divergent: number }

export interface RunReferenceImportArgs {
  referenceDir: string
}

function loadJson<T>(filePath: string): T {
  const raw = readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

function normalizeForCompare(s: string | null | undefined): string {
  return String(s ?? '').trim().toUpperCase()
}

async function chunked<T>(rows: T[], size: number, fn: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size))
  }
}

async function upsertItemCatalog(records: ItemCatalogJson[]): Promise<CatalogStats> {
  const existing = await db
    .select({ code: itemCatalog.code, description: itemCatalog.description, unit: itemCatalog.unit })
    .from(itemCatalog)
  const existingMap = new Map(existing.map((r) => [r.code, { description: r.description, unit: r.unit }]))

  const stats: CatalogStats = { newCodes: 0, unchanged: 0, divergent: 0 }

  for (const r of records) {
    const cur = existingMap.get(r.code)
    if (!cur) {
      stats.newCodes++
    } else if (
      normalizeForCompare(cur.description) !== normalizeForCompare(r.description) ||
      normalizeForCompare(cur.unit) !== normalizeForCompare(r.unit)
    ) {
      stats.divergent++
      console.warn(
        `[divergence] item_code=${r.code} ` +
        `description: "${cur.description}" -> "${r.description}" ; ` +
        `unit: "${cur.unit}" -> "${r.unit}"`
      )
    } else {
      stats.unchanged++
    }
  }

  await chunked(records, 500, async (batch) => {
    await db
      .insert(itemCatalog)
      .values(batch.map((r) => ({ code: r.code, description: r.description, unit: r.unit })))
      .onConflictDoUpdate({
        target: itemCatalog.code,
        set: {
          description: sql`EXCLUDED.description`,
          unit: sql`EXCLUDED.unit`,
          updatedAt: sql`NOW()`,
        },
      })
  })

  return stats
}

async function upsertItemPrices(records: ItemPriceJson[]): Promise<number> {
  const codes = [...new Set(records.map((r) => r.code))]
  if (codes.length === 0) return 0

  const catalogRows = await db
    .select({ id: itemCatalog.id, code: itemCatalog.code })
    .from(itemCatalog)
    .where(sql`${itemCatalog.code} = ANY(${sql.raw(`ARRAY[${codes.join(',')}]::integer[]`)})`)
  const idByCode = new Map(catalogRows.map((r) => [r.code, r.id]))

  let inserted = 0
  await chunked(records, 500, async (batch) => {
    const rows = batch
      .map((r) => {
        const catalogId = idByCode.get(r.code)
        if (!catalogId) return null
        return {
          catalogId,
          stateCode: r.state_code,
          referenceMonth: r.reference_month,
          isDesonerated: r.is_desonerated,
          unitPrice: r.unit_price,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (rows.length === 0) return

    await db
      .insert(itemPrices)
      .values(rows)
      .onConflictDoUpdate({
        target: [itemPrices.catalogId, itemPrices.stateCode, itemPrices.referenceMonth, itemPrices.isDesonerated],
        set: { unitPrice: sql`EXCLUDED.unit_price` },
      })
    inserted += rows.length
  })

  return inserted
}

async function upsertCompositionCatalog(records: CompositionCatalogJson[]): Promise<CatalogStats> {
  const existing = await db
    .select({ code: compositionCatalog.code, description: compositionCatalog.description, unit: compositionCatalog.unit })
    .from(compositionCatalog)
  const existingMap = new Map(existing.map((r) => [r.code, { description: r.description, unit: r.unit }]))

  const stats: CatalogStats = { newCodes: 0, unchanged: 0, divergent: 0 }

  for (const r of records) {
    const cur = existingMap.get(r.code)
    if (!cur) {
      stats.newCodes++
    } else if (
      normalizeForCompare(cur.description) !== normalizeForCompare(r.description) ||
      normalizeForCompare(cur.unit) !== normalizeForCompare(r.unit)
    ) {
      stats.divergent++
      console.warn(
        `[divergence] composition_code=${r.code} ` +
        `description: "${cur.description}" -> "${r.description}" ; ` +
        `unit: "${cur.unit}" -> "${r.unit}"`
      )
    } else {
      stats.unchanged++
    }
  }

  await chunked(records, 500, async (batch) => {
    await db
      .insert(compositionCatalog)
      .values(batch.map((r) => ({ code: r.code, description: r.description, unit: r.unit })))
      .onConflictDoUpdate({
        target: compositionCatalog.code,
        set: {
          description: sql`EXCLUDED.description`,
          unit: sql`EXCLUDED.unit`,
          updatedAt: sql`NOW()`,
        },
      })
  })

  return stats
}

async function upsertCompositionPrices(records: CompositionPriceJson[]): Promise<number> {
  const codes = [...new Set(records.map((r) => r.code))]
  if (codes.length === 0) return 0

  const catalogRows = await db
    .select({ id: compositionCatalog.id, code: compositionCatalog.code })
    .from(compositionCatalog)
    .where(sql`${compositionCatalog.code} = ANY(${sql.raw(`ARRAY[${codes.join(',')}]::integer[]`)})`)
  const idByCode = new Map(catalogRows.map((r) => [r.code, r.id]))

  let inserted = 0
  await chunked(records, 500, async (batch) => {
    const rows = batch
      .map((r) => {
        const catalogId = idByCode.get(r.code)
        if (!catalogId) return null
        return {
          catalogId,
          stateCode: r.state_code,
          referenceMonth: r.reference_month,
          isDesonerated: r.is_desonerated,
          baseUnitCost: r.base_unit_cost,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (rows.length === 0) return

    await db
      .insert(compositionPrices)
      .values(rows)
      .onConflictDoUpdate({
        target: [compositionPrices.catalogId, compositionPrices.stateCode, compositionPrices.referenceMonth, compositionPrices.isDesonerated],
        set: { baseUnitCost: sql`EXCLUDED.base_unit_cost` },
      })
    inserted += rows.length
  })

  return inserted
}

async function upsertCompositionItems(records: CompositionItemJson[]): Promise<number> {
  const compCodes = [...new Set(records.map((r) => r.composition_code))]
  if (compCodes.length === 0) return 0

  const catalogRows = await db
    .select({ id: compositionCatalog.id, code: compositionCatalog.code })
    .from(compositionCatalog)
    .where(sql`${compositionCatalog.code} = ANY(${sql.raw(`ARRAY[${compCodes.join(',')}]::integer[]`)})`)
  const idByCode = new Map(catalogRows.map((r) => [r.code, r.id]))

  let inserted = 0
  await chunked(records, 500, async (batch) => {
    const rows = batch
      .map((r) => {
        const compositionId = idByCode.get(r.composition_code)
        if (!compositionId) return null
        return {
          compositionId,
          itemType: r.item_type,
          itemCode: r.item_code,
          description: r.description,
          unit: r.unit,
          resourceType: null as string | null,
          coefficient: r.coefficient,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    if (rows.length === 0) return

    await db.insert(compositionItems).values(rows).onConflictDoNothing()
    inserted += rows.length
  })

  return inserted
}

export async function runReferenceImport({ referenceDir }: RunReferenceImportArgs) {
  const dir = resolve(referenceDir)
  console.log(`Reading reference bundle from: ${dir}`)

  const metadata = loadJson<{ reference_month: string; generated_at?: string; source_file?: string }>(
    join(dir, 'metadata.json')
  )
  console.log(`  reference_month: ${metadata.reference_month}`)
  if (metadata.generated_at) console.log(`  generated_at:    ${metadata.generated_at}`)
  if (metadata.source_file) console.log(`  source_file:     ${metadata.source_file}`)

  const itemsCat = loadJson<ItemCatalogJson[]>(join(dir, 'items_catalog.json'))
  const itemsPx = loadJson<ItemPriceJson[]>(join(dir, 'items_prices.json'))
  const compsCat = loadJson<CompositionCatalogJson[]>(join(dir, 'compositions_catalog.json'))
  const compsPx = loadJson<CompositionPriceJson[]>(join(dir, 'compositions_prices.json'))
  const compsItems = loadJson<CompositionItemJson[]>(join(dir, 'composition_items.json'))

  console.log(`  -> items_catalog:        ${itemsCat.length}`)
  console.log(`  -> items_prices:         ${itemsPx.length}`)
  console.log(`  -> compositions_catalog: ${compsCat.length}`)
  console.log(`  -> compositions_prices:  ${compsPx.length}`)
  console.log(`  -> composition_items:    ${compsItems.length}`)

  console.log('\nUpserting item_catalog...')
  const itemCatStats = await upsertItemCatalog(itemsCat)
  console.log('Upserting item_prices...')
  const itemPxInserted = await upsertItemPrices(itemsPx)
  console.log('Upserting composition_catalog...')
  const compCatStats = await upsertCompositionCatalog(compsCat)
  console.log('Upserting composition_prices...')
  const compPxInserted = await upsertCompositionPrices(compsPx)
  console.log('Upserting composition_items...')
  const compItemsInserted = await upsertCompositionItems(compsItems)

  console.log('')
  console.log('=== Reference import complete ===')
  console.log(`  Items — new codes:           ${itemCatStats.newCodes}`)
  console.log(`  Items — updated (no change): ${itemCatStats.unchanged}`)
  console.log(`  Items — updated (divergent): ${itemCatStats.divergent}`)
  console.log(`  Items — prices upserted:     ${itemPxInserted}`)
  console.log(`  Compositions — new codes:           ${compCatStats.newCodes}`)
  console.log(`  Compositions — updated (no change): ${compCatStats.unchanged}`)
  console.log(`  Compositions — updated (divergent): ${compCatStats.divergent}`)
  console.log(`  Compositions — prices upserted:     ${compPxInserted}`)
  console.log(`  Composition items upserted:         ${compItemsInserted}`)
}

if (import.meta.main) {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage: bun run src/db/import/sinapi.ts <path-to-extractor-reference-dir>')
    console.error('Example: bun run src/db/import/sinapi.ts ../sinapi-extractor/output/reference')
    process.exit(1)
  }

  runReferenceImport({ referenceDir: dir })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Reference import failed:', err)
      process.exit(1)
    })
}
