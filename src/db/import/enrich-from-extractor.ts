/**
 * Enriches item_catalog with metadata extracted from sinapi-extractor output.
 *
 * Reads a JSON file (default: ../sinapi-extractor/output/items.json) and updates
 * matching rows in civil_construction.item_catalog by natural code.
 *
 * Previously this updated the legacy `items` table, which meant one update per
 * (state × regime × month) tuple per code — ~40-54 rows touched per code.
 * With the dimensional schema, each update hits a single catalog row.
 */
import { db } from '../client'
import { itemCatalog } from '../schema/civil-construction'
import { eq } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { resolve } from 'path'

interface ExtractorItem {
  code: number
  description: string
  unit: string
  technical_standards: string
  general_info: string
  source_updated_at: string
  image: string
}

export async function runExtractorEnrich(jsonPath: string) {
  console.log(`Reading extractor data from: ${jsonPath}`)

  const raw = readFileSync(jsonPath, 'utf-8')
  const extractorItems: ExtractorItem[] = JSON.parse(raw)
  console.log(`  -> ${extractorItems.length} items in extractor output`)

  let updated = 0
  let notFound = 0

  for (const item of extractorItems) {
    const result = await db
      .update(itemCatalog)
      .set({
        technicalStandards: item.technical_standards || null,
        generalInfo: item.general_info || null,
        imageUrl: item.image || null,
        sourceUpdatedAt: (item.source_updated_at || null)?.slice(0, 20) || null,
        updatedAt: new Date(),
      })
      .where(eq(itemCatalog.code, item.code))
      .returning({ id: itemCatalog.id })

    if (result.length === 0) {
      notFound++
    } else {
      updated += result.length
    }

    if ((updated + notFound) % 500 === 0) {
      console.log(`  Progress: ${updated} rows updated, ${notFound} codes not found`)
    }
  }

  console.log(`\nDone!`)
  console.log(`  Rows updated: ${updated}`)
  console.log(`  Codes not found in catalog: ${notFound}`)
}

if (import.meta.main) {
  const EXTRACTOR_JSON_PATH =
    process.argv[2] || resolve(__dirname, '../../../../sinapi-extractor/output/items.json')

  runExtractorEnrich(EXTRACTOR_JSON_PATH)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Enrichment failed:', err)
      process.exit(1)
    })
}
