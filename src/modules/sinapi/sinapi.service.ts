import { db } from '../../db/client'
import { civilConstructionItemPrices, civilConstructionCompositionPrices } from '../../db/schema'
import { desc, eq, and } from 'drizzle-orm'
import { remember } from '../../shared/memory-cache'

const METADATA_CACHE_TTL_MS = 5 * 60 * 1000

export async function getAvailableStates(): Promise<string[]> {
  return remember('sinapi:available-states', METADATA_CACHE_TTL_MS, async () => {
    const [itemStates, compositionStates] = await Promise.all([
      db.selectDistinct({ stateCode: civilConstructionItemPrices.stateCode }).from(civilConstructionItemPrices),
      db.selectDistinct({ stateCode: civilConstructionCompositionPrices.stateCode }).from(civilConstructionCompositionPrices),
    ])

    const states = new Set<string>()
    itemStates.forEach((s) => states.add(s.stateCode))
    compositionStates.forEach((s) => states.add(s.stateCode))

    return Array.from(states).sort()
  })
}

export async function getReferenceMonths(state?: string): Promise<string[]> {
  const normalizedState = state?.toUpperCase()

  return remember(`sinapi:reference-months:${normalizedState ?? '*'}`, METADATA_CACHE_TTL_MS, async () => {
    const conditions = []
    if (normalizedState) {
      conditions.push(eq(civilConstructionItemPrices.stateCode, normalizedState))
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const result = await db
      .selectDistinct({ referenceMonth: civilConstructionItemPrices.referenceMonth })
      .from(civilConstructionItemPrices)
      .where(where)
      .orderBy(desc(civilConstructionItemPrices.referenceMonth))

    return result.map((r) => r.referenceMonth)
  })
}
