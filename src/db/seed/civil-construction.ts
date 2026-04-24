import { db } from '../client'
import { sectors } from '../schema/public'
import { items, compositions, compositionItems } from '../schema/civil-construction'

interface RawItem {
  code: number
  description: string
  unit: string
  state_code: string
  reference_month: string
  is_desonerated?: boolean
  unit_price?: number
  technical_standards?: string | null
  general_info?: string | null
  image?: string | null
  source_updated_at?: string | null
}

interface RawCompositionItem {
  item_type: 'INPUT' | 'SUB_COMPOSITION'
  code: number
  description: string
  unit: string
  resource_type?: 'MATERIAL' | 'LABOR' | 'EQUIPMENT' | null
  coefficient: string
  unit_price?: number
  total_price?: number
}

interface RawComposition {
  code: number
  description: string
  unit: string
  state_code: string
  reference_month: string
  is_desonerated?: boolean
  base_unit_cost?: number
  source_updated_at?: string | null
  items: RawCompositionItem[]
}

interface SeedData {
  items?: RawItem[]
  compositions?: RawComposition[]
}

function isValidDate(value: string | null | undefined): boolean {
  if (!value) return false
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value)
}

export async function seedCivilConstruction(dataPath: string) {
  const file = Bun.file(dataPath)
  const data: SeedData = await file.json()

  console.log('Seeding civil_construction sector...')

  // Upsert sector
  await db.insert(sectors).values({
    slug: 'civil-construction',
    name: 'Construção Civil',
    description: 'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (SINAPI)',
    schemaName: 'civil_construction',
  }).onConflictDoNothing()

  // Seed items
  const rawItems = data.items ?? []
  if (rawItems.length > 0) {
    console.log(`Seeding ${rawItems.length} items...`)
    const batchSize = 500
    for (let i = 0; i < rawItems.length; i += batchSize) {
      const batch = rawItems.slice(i, i + batchSize).map((raw) => ({
        code: raw.code,
        description: raw.description,
        unit: raw.unit,
        stateCode: raw.state_code.toUpperCase(),
        referenceMonth: raw.reference_month,
        isDesonerated: raw.is_desonerated ?? false,
        unitPrice: raw.unit_price ?? 0,
        technicalStandards: raw.technical_standards || null,
        generalInfo: raw.general_info || null,
        imageUrl: raw.image || null,
        sourceUpdatedAt: isValidDate(raw.source_updated_at) ? raw.source_updated_at : null,
      }))

      await db.insert(items).values(batch).onConflictDoNothing()
      console.log(`  ${Math.min(i + batchSize, rawItems.length)}/${rawItems.length} items inserted`)
    }
  }

  // Seed compositions
  const rawCompositions = data.compositions ?? []
  if (rawCompositions.length > 0) {
    console.log(`Seeding ${rawCompositions.length} compositions...`)
    const batchSize = 500
    for (let i = 0; i < rawCompositions.length; i += batchSize) {
      const batch = rawCompositions.slice(i, i + batchSize).map((raw) => ({
        code: raw.code,
        description: raw.description,
        unit: raw.unit,
        stateCode: raw.state_code.toUpperCase(),
        referenceMonth: raw.reference_month,
        isDesonerated: raw.is_desonerated ?? false,
        baseUnitCost: raw.base_unit_cost ?? 0,
        sourceUpdatedAt: isValidDate(raw.source_updated_at) ? raw.source_updated_at : null,
      }))

      await db.insert(compositions).values(batch).onConflictDoNothing()
      console.log(`  ${Math.min(i + batchSize, rawCompositions.length)}/${rawCompositions.length} compositions inserted`)
    }

    // Seed composition items — need to fetch inserted composition IDs
    console.log('Seeding composition items...')
    const allCompositions = await db.select({ id: compositions.id, code: compositions.code, stateCode: compositions.stateCode, referenceMonth: compositions.referenceMonth }).from(compositions)
    const compositionMap = new Map<string, number>()
    for (const c of allCompositions) {
      compositionMap.set(`${c.code}:${c.stateCode}:${c.referenceMonth}`, c.id)
    }

    const compItemsBatch: typeof compositionItems.$inferInsert[] = []
    for (const raw of rawCompositions) {
      const compId = compositionMap.get(`${raw.code}:${raw.state_code.toUpperCase()}:${raw.reference_month}`)
      if (!compId) {
        console.warn(`  Composition not found for items: ${raw.code} ${raw.state_code} ${raw.reference_month}`)
        continue
      }
      for (const item of raw.items) {
        compItemsBatch.push({
          compositionId: compId,
          itemType: item.item_type,
          code: item.code,
          description: item.description,
          unit: item.unit,
          resourceType: item.resource_type ?? null,
          coefficient: item.coefficient,
          unitPrice: item.unit_price ?? 0,
          totalPrice: item.total_price ?? 0,
        })
      }
    }

    for (let i = 0; i < compItemsBatch.length; i += 500) {
      const batch = compItemsBatch.slice(i, i + 500)
      await db.insert(compositionItems).values(batch).onConflictDoNothing()
      console.log(`  ${Math.min(i + 500, compItemsBatch.length)}/${compItemsBatch.length} composition items inserted`)
    }
  }

  console.log('Civil construction seed complete.')
}
