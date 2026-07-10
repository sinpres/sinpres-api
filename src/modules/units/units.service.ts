import { db } from '../../db/client'
import { sql } from 'drizzle-orm'
import { remember } from '../../shared/memory-cache'

const UNITS_CACHE_TTL_MS = 60 * 60 * 1000

export async function getUnitsBySector(schemaName: string): Promise<string[]> {
  if (schemaName !== 'civil_construction') {
    return []
  }

  return remember(`units:${schemaName}`, UNITS_CACHE_TTL_MS, async () => {
    const result = await db.execute<{ unit: string }>(sql`
      SELECT UPPER(unit) AS unit FROM civil_construction.item_catalog
      UNION
      SELECT UPPER(unit) AS unit FROM civil_construction.composition_catalog
      ORDER BY unit ASC
    `)

    const rows = (result as unknown as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
    return (rows as Array<{ unit: string }>).map((row) => row.unit)
  })
}
