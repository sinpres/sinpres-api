/**
 * Seed orchestrator.
 *
 * Runs the three real SINAPI importers in sequence against files on disk:
 *   1. XLSX reference  (insumos, compositions, analytical items) -> sinapi.ts
 *   2. Extractor JSON  (technical specs, images, etc.)           -> enrich-from-extractor.ts
 *   3. Maintenances    (previous_code substitutions)             -> maintenances.ts
 *
 * Paths are configurable via env vars or positional argv, with sensible defaults for
 * Henrik's local layout. Missing files are skipped with a warning rather than aborting,
 * so the seed remains usable in environments without the full monthly bundle.
 *
 * Idempotent: each importer uses ON CONFLICT DO UPDATE, so re-running does not duplicate
 * rows and simply refreshes values.
 */
import { existsSync } from 'fs'
import { resolve } from 'path'
import { db } from '../client'
import { sql } from 'drizzle-orm'
import { upsertCivilConstructionSector } from './civil-construction'
import { runSinapiImport } from '../import/sinapi'
import { runExtractorEnrich } from '../import/enrich-from-extractor'
import { runMaintenancesImport } from '../import/maintenances'

const DEFAULT_XLSX = '/Users/henrik/Downloads/SINAPI-2026-03-formato-xlsx/SINAPI_Referência_2026_03.xlsx'
const DEFAULT_EXTRACTOR_JSON = '/Volumes/programacao/sinapi-extractor/output/items.json'
const DEFAULT_MAINTENANCES = '/Users/henrik/Downloads/SINAPI-2026-03-formato-xlsx/SINAPI_Manutenções_2026_03.xlsx'
const DEFAULT_REFERENCE_MONTH = '2026-03'

interface SeedConfig {
  xlsxPath: string
  extractorJsonPath: string
  maintenancesPath: string
  referenceMonth: string
}

function resolveConfig(): SeedConfig {
  return {
    xlsxPath: resolve(process.env.SEED_XLSX_PATH ?? DEFAULT_XLSX),
    extractorJsonPath: resolve(process.env.SEED_EXTRACTOR_JSON ?? DEFAULT_EXTRACTOR_JSON),
    maintenancesPath: resolve(process.env.SEED_MAINTENANCES ?? DEFAULT_MAINTENANCES),
    referenceMonth: process.env.SEED_REFERENCE_MONTH ?? DEFAULT_REFERENCE_MONTH,
  }
}

interface Counts {
  itemCatalog: number
  itemPrices: number
  compositionCatalog: number
  compositionPrices: number
  compositionItemsV2: number
  itemsWithPrevious: number
  compsWithPrevious: number
}

async function countRows(): Promise<Counts> {
  const rows = (await db.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM civil_construction.item_catalog) AS item_catalog,
      (SELECT COUNT(*)::int FROM civil_construction.item_prices) AS item_prices,
      (SELECT COUNT(*)::int FROM civil_construction.composition_catalog) AS composition_catalog,
      (SELECT COUNT(*)::int FROM civil_construction.composition_prices) AS composition_prices,
      (SELECT COUNT(*)::int FROM civil_construction.composition_items_v2) AS composition_items_v2,
      (SELECT COUNT(*)::int FROM civil_construction.item_catalog WHERE previous_code IS NOT NULL) AS items_with_previous,
      (SELECT COUNT(*)::int FROM civil_construction.composition_catalog WHERE previous_code IS NOT NULL) AS comps_with_previous
  `)) as unknown as { rows?: Record<string, number>[] } | Record<string, number>[]

  const resultRow = Array.isArray(rows) ? rows[0] : rows.rows?.[0]
  if (!resultRow) {
    return {
      itemCatalog: 0,
      itemPrices: 0,
      compositionCatalog: 0,
      compositionPrices: 0,
      compositionItemsV2: 0,
      itemsWithPrevious: 0,
      compsWithPrevious: 0,
    }
  }

  return {
    itemCatalog: Number(resultRow.item_catalog ?? 0),
    itemPrices: Number(resultRow.item_prices ?? 0),
    compositionCatalog: Number(resultRow.composition_catalog ?? 0),
    compositionPrices: Number(resultRow.composition_prices ?? 0),
    compositionItemsV2: Number(resultRow.composition_items_v2 ?? 0),
    itemsWithPrevious: Number(resultRow.items_with_previous ?? 0),
    compsWithPrevious: Number(resultRow.comps_with_previous ?? 0),
  }
}

async function main() {
  const config = resolveConfig()

  console.log('=== SINPRES seed — starting ===')
  console.log(`  xlsxPath:          ${config.xlsxPath}`)
  console.log(`  extractorJsonPath: ${config.extractorJsonPath}`)
  console.log(`  maintenancesPath:  ${config.maintenancesPath}`)
  console.log(`  referenceMonth:    ${config.referenceMonth}`)
  console.log('')

  await upsertCivilConstructionSector()

  if (existsSync(config.xlsxPath)) {
    console.log('\n--- [1/3] SINAPI XLSX import ---')
    await runSinapiImport({ referenceMonth: config.referenceMonth, filePath: config.xlsxPath })
  } else {
    console.warn(`[WARN] XLSX not found at ${config.xlsxPath} — skipping SINAPI reference import.`)
  }

  if (existsSync(config.extractorJsonPath)) {
    console.log('\n--- [2/3] Extractor enrichment ---')
    await runExtractorEnrich(config.extractorJsonPath)
  } else {
    console.warn(
      `[WARN] Extractor JSON not found at ${config.extractorJsonPath} — skipping enrichment.`
    )
  }

  if (existsSync(config.maintenancesPath)) {
    console.log('\n--- [3/3] Maintenances import ---')
    await runMaintenancesImport(config.maintenancesPath)
  } else {
    console.warn(
      `[WARN] Maintenances file not found at ${config.maintenancesPath} — skipping maintenances import.`
    )
  }

  const counts = await countRows()
  console.log('')
  console.log('=== Seed complete ===')
  console.log(`  item_catalog:                    ${counts.itemCatalog} rows`)
  console.log(`  item_prices:                     ${counts.itemPrices} rows`)
  console.log(`  composition_catalog:             ${counts.compositionCatalog} rows`)
  console.log(`  composition_prices:              ${counts.compositionPrices} rows`)
  console.log(`  composition_items_v2:            ${counts.compositionItemsV2} rows`)
  console.log(`  items with previous_code:        ${counts.itemsWithPrevious}`)
  console.log(`  compositions with previous_code: ${counts.compsWithPrevious}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
