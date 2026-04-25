/**
 * Enriches item_catalog with metadata extracted from sinapi-extractor output.
 *
 * Reads a JSON file (default: ../sinapi-extractor/output/items.json) and updates
 * matching rows in civil_construction.item_catalog by natural code.
 *
 * IMAGE URL: the extractor JSON carries a relative path like "images/34.jpeg".
 * Once images are uploaded to a CDN/Blob (see upload-images-to-blob.ts) the catalog
 * holds an absolute https:// URL. We do NOT overwrite an absolute URL with a
 * relative path here — only fill the field when the catalog has no image_url yet,
 * or when both sides are relative paths. This guards against a stale enrich run
 * regressing the public CDN URLs and breaking image rendering on the explorer.
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

  // Pre-fetch current image_url values so we can decide whether to overwrite them
  const existing = await db.select({ code: itemCatalog.code, imageUrl: itemCatalog.imageUrl }).from(itemCatalog)
  const currentImageByCode = new Map(existing.map((r) => [r.code, r.imageUrl]))

  let updated = 0
  let notFound = 0
  let imageProtected = 0

  for (const item of extractorItems) {
    const newRelativeImage = item.image || null
    const currentUrl = currentImageByCode.get(item.code) ?? null
    const currentIsAbsolute = currentUrl?.startsWith('https://') ?? false

    // Keep absolute (CDN) URLs intact; only fill if catalog has no URL or also relative.
    const nextImageUrl = currentIsAbsolute ? currentUrl : newRelativeImage
    if (currentIsAbsolute && newRelativeImage && newRelativeImage !== currentUrl) {
      imageProtected++
    }

    const result = await db
      .update(itemCatalog)
      .set({
        technicalStandards: item.technical_standards || null,
        generalInfo: item.general_info || null,
        imageUrl: nextImageUrl,
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
      console.log(`  Progress: ${updated} rows updated, ${notFound} codes not found, ${imageProtected} image URLs preserved`)
    }
  }

  console.log(`\nDone!`)
  console.log(`  Rows updated:         ${updated}`)
  console.log(`  Codes not found:      ${notFound}`)
  console.log(`  Image URLs preserved: ${imageProtected} (absolute CDN URLs not overwritten by relative paths)`)
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
