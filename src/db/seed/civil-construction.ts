import { db } from '../client'
import { sectors } from '../schema/public'
import { items as itemsTable, categories as categoriesTable } from '../schema/civil-construction'

interface RawItem {
  code: number
  description: string
  unit: string
  technical_standards: string
  general_info: string
  image: string
  source_updated_at: string
}

function isValidDate(value: string | null | undefined): boolean {
  if (!value) return false
  // Match date formats like DD/MM/YYYY
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value)
}

export async function seedCivilConstruction(dataPath: string) {
  const file = Bun.file(dataPath)
  const rawItems: RawItem[] = await file.json()

  console.log(`Seeding civil_construction with ${rawItems.length} items...`)

  // Upsert sector
  await db.insert(sectors).values({
    slug: 'civil-construction',
    name: 'Construção Civil',
    description: 'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (SINAPI)',
    schemaName: 'civil_construction',
  }).onConflictDoNothing()

  // Insert items in batches of 500
  const batchSize = 500
  for (let i = 0; i < rawItems.length; i += batchSize) {
    const batch = rawItems.slice(i, i + batchSize).map((raw) => ({
      code: raw.code,
      description: raw.description,
      unit: raw.unit,
      technicalStandards: raw.technical_standards || null,
      generalInfo: raw.general_info || null,
      imageUrl: raw.image || null,
      sourceUpdatedAt: isValidDate(raw.source_updated_at) ? raw.source_updated_at : null,
    }))

    await db.insert(itemsTable).values(batch).onConflictDoNothing()
    console.log(`  ${Math.min(i + batchSize, rawItems.length)}/${rawItems.length} items inserted`)
  }

  console.log('Civil construction seed complete.')
}
