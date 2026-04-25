import { db } from '../src/db/client'
import { sectors } from '../src/db/schema/public'
import {
  itemCatalog, itemPrices, compositionCatalog, compositionPrices,
  compositionItems,
} from '../src/db/schema/civil-construction'
import { sql } from 'drizzle-orm'

// Deterministic synthetic fixtures. Tests must be fast (under 1s) and independent of
// the Caixa monthly bundle — a full XLSX import would take minutes and any change in
// real codes would break assertions. Seed orchestrator (src/db/seed/seed.ts) handles
// the real data path for local dev and staging.
async function seed() {
  await db.execute(sql`
    TRUNCATE TABLE
      civil_construction.composition_items,
      civil_construction.composition_prices,
      civil_construction.composition_catalog,
      civil_construction.item_prices,
      civil_construction.item_catalog,
      public.sectors
    RESTART IDENTITY CASCADE
  `)

  await db.insert(sectors).values({
    slug: 'civil-construction',
    name: 'Construção Civil',
    description: 'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (SINAPI)',
    schemaName: 'civil_construction',
  })

  const insertedItems = await db.insert(itemCatalog).values([
    { code: 1, description: 'ACETILENO', unit: 'M3', previousCode: null },
    { code: 2, description: 'TUBO PVC 50MM', unit: 'M', previousCode: null },
    { code: 3, description: 'CIMENTO PORTLAND', unit: 'KG', previousCode: null },
    { code: 4, description: 'AREIA MEDIA', unit: 'M3', previousCode: null },
    { code: 5, description: 'PEDREIRO', unit: 'H', previousCode: null },
    { code: 100, description: 'INSUMO NOVO SUBSTITUTO', unit: 'UN', previousCode: 99 },
  ]).returning({ id: itemCatalog.id, code: itemCatalog.code })

  const itemCatalogIdByCode = new Map(insertedItems.map((r) => [r.code, r.id]))

  await db.insert(itemPrices).values([
    { catalogId: itemCatalogIdByCode.get(1)!, stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 1234 },
    { catalogId: itemCatalogIdByCode.get(2)!, stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 5678 },
    { catalogId: itemCatalogIdByCode.get(3)!, stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 900 },
    { catalogId: itemCatalogIdByCode.get(4)!, stateCode: 'RJ', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 4500 },
    { catalogId: itemCatalogIdByCode.get(5)!, stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 2500 },
    { catalogId: itemCatalogIdByCode.get(100)!, stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, unitPrice: 777 },
  ])

  const insertedComps = await db.insert(compositionCatalog).values([
    { code: 1001, description: 'ALVENARIA DE VEDAÇÃO EM BLOCO CERÂMICO', unit: 'M2', previousCode: null },
    { code: 1002, description: 'REVESTIMENTO CERÂMICO', unit: 'M2', previousCode: null },
  ]).returning({ id: compositionCatalog.id, code: compositionCatalog.code })

  const compIdByCode = new Map(insertedComps.map((r) => [r.code, r.id]))

  await db.insert(compositionPrices).values([
    { catalogId: compIdByCode.get(1001)!, stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, baseUnitCost: 15000 },
    { catalogId: compIdByCode.get(1002)!, stateCode: 'SP', referenceMonth: '2026-04', isDesonerated: false, baseUnitCost: 8500 },
  ])

  await db.insert(compositionItems).values([
    { compositionId: compIdByCode.get(1001)!, itemType: 'INPUT', itemCode: 3, description: 'CIMENTO PORTLAND', unit: 'KG', resourceType: 'MATERIAL', coefficient: '0.250000' },
    { compositionId: compIdByCode.get(1001)!, itemType: 'INPUT', itemCode: 5, description: 'PEDREIRO', unit: 'H', resourceType: 'LABOR', coefficient: '1.500000' },
  ])
}

await seed()
