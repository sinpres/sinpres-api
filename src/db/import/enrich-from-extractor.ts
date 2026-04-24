/**
 * Enriches existing items in the database with data from sinapi-extractor output.
 * Reads output/items.json and updates matching items by code.
 */
import { db } from '../client'
import { items } from '../schema/civil-construction'
import { eq, sql } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const EXTRACTOR_JSON_PATH = process.argv[2] || resolve(__dirname, '../../../../sinapi-extractor/output/items.json')

interface ExtractorItem {
  code: number
  description: string
  unit: string
  technical_standards: string
  general_info: string
  source_updated_at: string
  image: string
}

async function main() {
  console.log(`Reading extractor data from: ${EXTRACTOR_JSON_PATH}`)

  const raw = readFileSync(EXTRACTOR_JSON_PATH, 'utf-8')
  const extractorItems: ExtractorItem[] = JSON.parse(raw)
  console.log(`  -> ${extractorItems.length} items in extractor output`)

  let updated = 0
  let notFound = 0

  for (const item of extractorItems) {
    // Try to find matching items by code (may match multiple states/months)
    const result = await db
      .update(items)
      .set({
        technicalStandards: item.technical_standards || null,
        generalInfo: item.general_info || null,
        imageUrl: item.image || null,
        sourceUpdatedAt: (item.source_updated_at || null)?.slice(0, 20) || null,
      })
      .where(eq(items.code, item.code))
      .returning({ id: items.id })

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
  console.log(`  Codes not found in DB: ${notFound}`)
  process.exit(0)
}

main().catch((err) => {
  console.error('Enrichment failed:', err)
  process.exit(1)
})
