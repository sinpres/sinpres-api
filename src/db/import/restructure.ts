/**
 * HISTORICAL / ONE-SHOT — kept for audit trail only.
 *
 * This script was used once during the dimensional restructure (Blocks 1-6) to
 * populate the new tables from the legacy ones. After Block 6 dropped the legacy
 * tables (items, compositions, composition_items) and renamed composition_items_v2
 * to composition_items, running this script WILL FAIL because:
 *   - The source legacy tables no longer exist.
 *   - The target table composition_items_v2 no longer exists.
 *
 * DO NOT delete this file — it documents the data migration that happened.
 * For new imports, use src/db/import/sinapi.ts.
 *
 * Original description:
 * Data migration script: populates the new dimensional tables from the legacy tables.
 *
 * Target tables (new):
 *   - civil_construction.item_catalog
 *   - civil_construction.item_prices
 *   - civil_construction.composition_catalog
 *   - civil_construction.composition_prices
 *   - civil_construction.composition_items_v2  (now named composition_items)
 *
 * Source tables (legacy, read-only):
 *   - civil_construction.items                 (DROPPED in Block 6)
 *   - civil_construction.compositions          (DROPPED in Block 6)
 *   - civil_construction.composition_items     (DROPPED in Block 6, name reused by v2)
 *
 * Properties:
 *   - SCD Type 1 canonical row by (code, source_updated_at DESC NULLS LAST).
 *   - Idempotent: skips INSERTs when target tables already have rows.
 *   - Single transaction: validates counts and rolls back on mismatch.
 */
import { db } from '../client'
import { sql } from 'drizzle-orm'

interface CountRow {
  n: string | number
}

async function scalarCount(executor: typeof db, query: ReturnType<typeof sql>): Promise<number> {
  const rows = (await executor.execute(query)) as unknown as CountRow[]
  const first = rows[0]
  if (!first) return 0
  return Number((first as any).n ?? 0)
}

async function main() {
  console.log('=== Data migration: legacy -> new dimensional tables ===')

  // Baseline expected counts from legacy tables (read outside tx — just diagnostics)
  const itemsTotal = await scalarCount(db, sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.items`)
  const itemsDistinctCodes = await scalarCount(
    db,
    sql`SELECT COUNT(DISTINCT code)::bigint AS n FROM civil_construction.items`
  )
  const compositionsTotal = await scalarCount(
    db,
    sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.compositions`
  )
  const compositionsDistinctCodes = await scalarCount(
    db,
    sql`SELECT COUNT(DISTINCT code)::bigint AS n FROM civil_construction.compositions`
  )
  const compositionItemsTotal = await scalarCount(
    db,
    sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.composition_items`
  )

  console.log('Legacy baseline:')
  console.log(`  items:              ${itemsTotal} rows, ${itemsDistinctCodes} distinct codes`)
  console.log(`  compositions:       ${compositionsTotal} rows, ${compositionsDistinctCodes} distinct codes`)
  console.log(`  composition_items:  ${compositionItemsTotal} rows`)
  console.log('')

  await db.transaction(async (tx) => {
    // ----------------------------------------------------------------------
    // Step 1: item_catalog
    // ----------------------------------------------------------------------
    const itemCatalogExisting = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.item_catalog`
    )
    if (itemCatalogExisting > 0) {
      console.log(`[1/5] item_catalog: skipping, already populated (${itemCatalogExisting} rows)`)
    } else {
      console.log('[1/5] item_catalog: inserting...')
      await tx.execute(sql`
        INSERT INTO civil_construction.item_catalog
          (code, description, unit, image_url, technical_standards, general_info,
           source_updated_at, metadata, category_id, created_at, updated_at)
        SELECT DISTINCT ON (code)
          code, description, unit, image_url, technical_standards, general_info,
          source_updated_at, metadata, category_id, NOW(), NOW()
        FROM civil_construction.items
        ORDER BY code, source_updated_at DESC NULLS LAST, id DESC
      `)
    }

    // ----------------------------------------------------------------------
    // Step 2: item_prices
    // ----------------------------------------------------------------------
    const itemPricesExisting = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.item_prices`
    )
    if (itemPricesExisting > 0) {
      console.log(`[2/5] item_prices: skipping, already populated (${itemPricesExisting} rows)`)
    } else {
      console.log('[2/5] item_prices: inserting...')
      await tx.execute(sql`
        INSERT INTO civil_construction.item_prices
          (catalog_id, state_code, reference_month, is_desonerated, unit_price, created_at)
        SELECT ic.id, i.state_code, i.reference_month, i.is_desonerated, i.unit_price, NOW()
        FROM civil_construction.items i
        JOIN civil_construction.item_catalog ic ON ic.code = i.code
        ON CONFLICT (catalog_id, state_code, reference_month, is_desonerated) DO NOTHING
      `)
    }

    // ----------------------------------------------------------------------
    // Step 3: composition_catalog
    // ----------------------------------------------------------------------
    const compCatalogExisting = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.composition_catalog`
    )
    if (compCatalogExisting > 0) {
      console.log(`[3/5] composition_catalog: skipping, already populated (${compCatalogExisting} rows)`)
    } else {
      console.log('[3/5] composition_catalog: inserting...')
      await tx.execute(sql`
        INSERT INTO civil_construction.composition_catalog
          (code, description, unit, source_updated_at, created_at, updated_at)
        SELECT DISTINCT ON (code)
          code, description, unit, source_updated_at, NOW(), NOW()
        FROM civil_construction.compositions
        ORDER BY code, source_updated_at DESC NULLS LAST, id DESC
      `)
    }

    // ----------------------------------------------------------------------
    // Step 4: composition_prices
    // ----------------------------------------------------------------------
    const compPricesExisting = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.composition_prices`
    )
    if (compPricesExisting > 0) {
      console.log(`[4/5] composition_prices: skipping, already populated (${compPricesExisting} rows)`)
    } else {
      console.log('[4/5] composition_prices: inserting...')
      await tx.execute(sql`
        INSERT INTO civil_construction.composition_prices
          (catalog_id, state_code, reference_month, is_desonerated, base_unit_cost, created_at)
        SELECT cc.id, c.state_code, c.reference_month, c.is_desonerated, c.base_unit_cost, NOW()
        FROM civil_construction.compositions c
        JOIN civil_construction.composition_catalog cc ON cc.code = c.code
        ON CONFLICT (catalog_id, state_code, reference_month, is_desonerated) DO NOTHING
      `)
    }

    // ----------------------------------------------------------------------
    // Step 5: composition_items_v2 (dedupe across ISD/ICD instances)
    // ----------------------------------------------------------------------
    const compItemsV2Existing = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.composition_items_v2`
    )
    if (compItemsV2Existing > 0) {
      console.log(`[5/5] composition_items_v2: skipping, already populated (${compItemsV2Existing} rows)`)
    } else {
      console.log('[5/5] composition_items_v2: inserting...')
      await tx.execute(sql`
        INSERT INTO civil_construction.composition_items_v2
          (composition_id, item_type, item_code, description, unit, resource_type, coefficient, created_at)
        SELECT DISTINCT ON (cc.id, ci.item_type, ci.code)
          cc.id, ci.item_type, ci.code, ci.description, ci.unit, ci.resource_type, ci.coefficient, NOW()
        FROM civil_construction.composition_items ci
        JOIN civil_construction.compositions c ON c.id = ci.composition_id
        JOIN civil_construction.composition_catalog cc ON cc.code = c.code
        ORDER BY cc.id, ci.item_type, ci.code, ci.id
        ON CONFLICT (composition_id, item_type, item_code) DO NOTHING
      `)
    }

    // ----------------------------------------------------------------------
    // Validation
    // ----------------------------------------------------------------------
    const itemCatalogCount = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.item_catalog`
    )
    const itemPricesCount = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.item_prices`
    )
    const compCatalogCount = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.composition_catalog`
    )
    const compPricesCount = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.composition_prices`
    )
    const compItemsV2Count = await scalarCount(
      tx as any,
      sql`SELECT COUNT(*)::bigint AS n FROM civil_construction.composition_items_v2`
    )

    if (itemCatalogCount !== itemsDistinctCodes) {
      throw new Error(
        `Validation failed: item_catalog has ${itemCatalogCount} rows, expected ${itemsDistinctCodes} (= COUNT(DISTINCT code) FROM items). Rolling back.`
      )
    }
    if (itemPricesCount !== itemsTotal) {
      throw new Error(
        `Validation failed: item_prices has ${itemPricesCount} rows, expected ${itemsTotal} (= COUNT(*) FROM items). Rolling back.`
      )
    }
    if (compCatalogCount !== compositionsDistinctCodes) {
      throw new Error(
        `Validation failed: composition_catalog has ${compCatalogCount} rows, expected ${compositionsDistinctCodes} (= COUNT(DISTINCT code) FROM compositions). Rolling back.`
      )
    }
    if (compPricesCount !== compositionsTotal) {
      throw new Error(
        `Validation failed: composition_prices has ${compPricesCount} rows, expected ${compositionsTotal} (= COUNT(*) FROM compositions). Rolling back.`
      )
    }

    console.log('')
    console.log('=== Data migration complete ===')
    console.log(`  item_catalog:         ${itemCatalogCount} rows (expected ${itemsDistinctCodes})`)
    console.log(`  item_prices:          ${itemPricesCount} rows (expected ${itemsTotal})`)
    console.log(`  composition_catalog:  ${compCatalogCount} rows (expected ${compositionsDistinctCodes})`)
    console.log(`  composition_prices:   ${compPricesCount} rows (expected ${compositionsTotal})`)
    console.log(`  composition_items_v2: ${compItemsV2Count} rows`)
  })
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
