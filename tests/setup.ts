import { db } from '../src/db/client'
import { sectors } from '../src/db/schema/public'
import { items, compositions, compositionItems } from '../src/db/schema/civil-construction'
import { sql } from 'drizzle-orm'

async function seed() {
  // Clean tables before seeding
  await db.execute(sql`TRUNCATE TABLE civil_construction.composition_items, civil_construction.compositions, civil_construction.items, public.sectors RESTART IDENTITY CASCADE`)

  // Insert test sector
  await db.insert(sectors).values({
    slug: 'civil-construction',
    name: 'Construção Civil',
    description: 'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (SINAPI)',
    schemaName: 'civil_construction',
  }).onConflictDoNothing()

  // Insert test items
  const testItems = [
    { code: 1, description: 'ACETILENO', unit: 'M3', stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 1234, technicalStandards: null, generalInfo: null, imageUrl: null, sourceUpdatedAt: null },
    { code: 2, description: 'TUBO PVC 50MM', unit: 'M', stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 5678, technicalStandards: null, generalInfo: null, imageUrl: null, sourceUpdatedAt: null },
    { code: 3, description: 'CIMENTO PORTLAND', unit: 'KG', stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 900, technicalStandards: null, generalInfo: null, imageUrl: null, sourceUpdatedAt: null },
    { code: 4, description: 'AREIA MEDIA', unit: 'M3', stateCode: 'RJ', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 4500, technicalStandards: null, generalInfo: null, imageUrl: null, sourceUpdatedAt: null },
    { code: 5, description: 'PEDREIRO', unit: 'H', stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 2500, technicalStandards: null, generalInfo: null, imageUrl: null, sourceUpdatedAt: null },
  ]

  await db.insert(items).values(testItems).onConflictDoNothing()

  // Insert test compositions
  const testCompositions = [
    { code: 1001, description: 'ALVENARIA DE VEDAÇÃO EM BLOCO CERÂMICO', unit: 'M2', stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, baseUnitCost: 15000, sourceUpdatedAt: null },
    { code: 1002, description: 'REVESTIMENTO CERÂMICO', unit: 'M2', stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, baseUnitCost: 8500, sourceUpdatedAt: null },
  ]

  await db.insert(compositions).values(testCompositions).onConflictDoNothing()

  const insertedCompositions = await db.select().from(compositions)

  if (insertedCompositions.length > 0) {
    const comp1 = insertedCompositions.find(c => c.code === 1001)
    if (comp1) {
      await db.insert(compositionItems).values([
        { compositionId: comp1.id, itemType: 'INPUT', code: 3, description: 'CIMENTO PORTLAND', unit: 'KG', resourceType: 'MATERIAL', coefficient: '0.250000', unitPrice: 900, totalPrice: 225 },
        { compositionId: comp1.id, itemType: 'INPUT', code: 5, description: 'PEDREIRO', unit: 'H', resourceType: 'LABOR', coefficient: '1.500000', unitPrice: 2500, totalPrice: 3750 },
      ]).onConflictDoNothing()
    }
  }
}

await seed()
