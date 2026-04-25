/**
 * Seed orchestrator.
 *
 * Runs the three importers in sequence, all consuming JSONs produced by the
 * sinapi-extractor (no XLSX/PDF parsing happens in the API anymore):
 *   1. Reference bundle  (output/reference/*.json)         -> sinapi.ts (runReferenceImport)
 *   2. Technical specs   (output/items.json + images/)     -> enrich-from-extractor.ts
 *   3. Maintenances      (output/maintenances.json)        -> maintenances.ts
 *
 * Paths are configurable via env vars or defaults that point to the local
 * sinapi-extractor checkout. Missing files are skipped with a warning rather than
 * aborting, so the seed remains usable in environments without the full bundle.
 *
 * Idempotent: each importer uses ON CONFLICT DO UPDATE, so re-running does not
 * duplicate rows and simply refreshes values.
 */
import { existsSync } from 'fs'
import { resolve } from 'path'
import { db } from '../client'
import { sql } from 'drizzle-orm'
import { upsertCivilConstructionSector } from './civil-construction'
import { runReferenceImport } from '../import/sinapi'
import { runExtractorEnrich } from '../import/enrich-from-extractor'
import { runMaintenancesImport } from '../import/maintenances'

const DEFAULT_REFERENCE_DIR = '/Volumes/programacao/sinapi-extractor/output/reference'
const DEFAULT_EXTRACTOR_JSON = '/Volumes/programacao/sinapi-extractor/output/items.json'
const DEFAULT_MAINTENANCES = '/Volumes/programacao/sinapi-extractor/output/maintenances.json'

interface SeedConfig {
  referenceDir: string
  extractorJsonPath: string
  maintenancesPath: string
}

function resolveConfig(): SeedConfig {
  return {
    referenceDir: resolve(process.env.SEED_REFERENCE_DIR ?? DEFAULT_REFERENCE_DIR),
    extractorJsonPath: resolve(process.env.SEED_EXTRACTOR_JSON ?? DEFAULT_EXTRACTOR_JSON),
    maintenancesPath: resolve(process.env.SEED_MAINTENANCES ?? DEFAULT_MAINTENANCES),
  }
}

interface Counts {
  itemCatalog: number
  itemPrices: number
  compositionCatalog: number
  compositionPrices: number
  compositionItems: number
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
      (SELECT COUNT(*)::int FROM civil_construction.composition_items) AS composition_items,
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
      compositionItems: 0,
      itemsWithPrevious: 0,
      compsWithPrevious: 0,
    }
  }

  return {
    itemCatalog: Number(resultRow.item_catalog ?? 0),
    itemPrices: Number(resultRow.item_prices ?? 0),
    compositionCatalog: Number(resultRow.composition_catalog ?? 0),
    compositionPrices: Number(resultRow.composition_prices ?? 0),
    compositionItems: Number(resultRow.composition_items ?? 0),
    itemsWithPrevious: Number(resultRow.items_with_previous ?? 0),
    compsWithPrevious: Number(resultRow.comps_with_previous ?? 0),
  }
}

async function main() {
  const config = resolveConfig()

  console.log('=== SINPRES seed — starting ===')
  console.log(`  referenceDir:      ${config.referenceDir}`)
  console.log(`  extractorJsonPath: ${config.extractorJsonPath}`)
  console.log(`  maintenancesPath:  ${config.maintenancesPath}`)
  console.log('')

  await upsertCivilConstructionSector()

  const referenceMetadata = resolve(config.referenceDir, 'metadata.json')
  if (existsSync(referenceMetadata)) {
    console.log('\n--- [1/3] Reference import (from extractor JSONs) ---')
    await runReferenceImport({ referenceDir: config.referenceDir })
  } else {
    console.warn(
      `[WARN] Reference bundle not found at ${config.referenceDir} ` +
      `(missing metadata.json). Run sinapi-extractor first: ` +
      `python3 src/extract_reference.py <YYYY-MM> <xlsx>`
    )
  }

  if (existsSync(config.extractorJsonPath)) {
    console.log('\n--- [2/3] Technical sheets enrichment ---')
    await runExtractorEnrich(config.extractorJsonPath)
  } else {
    console.warn(
      `[WARN] Extractor items.json not found at ${config.extractorJsonPath} — skipping enrichment.`
    )
  }

  if (existsSync(config.maintenancesPath)) {
    console.log('\n--- [3/3] Maintenances import ---')
    await runMaintenancesImport(config.maintenancesPath)
  } else {
    console.warn(
      `[WARN] Maintenances JSON not found at ${config.maintenancesPath} — skipping maintenances import.`
    )
  }

  const counts = await countRows()
  console.log('')
  console.log('=== Seed complete ===')
  console.log(`  item_catalog:                    ${counts.itemCatalog} rows`)
  console.log(`  item_prices:                     ${counts.itemPrices} rows`)
  console.log(`  composition_catalog:             ${counts.compositionCatalog} rows`)
  console.log(`  composition_prices:              ${counts.compositionPrices} rows`)
  console.log(`  composition_items:               ${counts.compositionItems} rows`)
  console.log(`  items with previous_code:        ${counts.itemsWithPrevious}`)
  console.log(`  compositions with previous_code: ${counts.compsWithPrevious}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
