import { db } from '../client'
import { sectors } from '../schema/public'

/**
 * Upserts the civil_construction sector row in public.sectors. Idempotent — safe to call
 * repeatedly. No domain data is inserted here; real data is loaded by the SINAPI,
 * extractor, and maintenances importers invoked from seed.ts.
 */
export async function upsertCivilConstructionSector() {
  console.log('Upserting sector civil-construction...')
  await db
    .insert(sectors)
    .values({
      slug: 'civil-construction',
      name: 'Construção Civil',
      description:
        'Sistema Nacional de Pesquisa de Custos e Índices da Construção Civil (SINAPI)',
      schemaName: 'civil_construction',
    })
    .onConflictDoNothing()
}
