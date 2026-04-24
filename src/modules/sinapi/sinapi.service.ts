import { db } from '../../db/client'
import { civilConstructionItems, civilConstructionCompositions } from '../../db/schema'
import { sql, desc, eq, and } from 'drizzle-orm'

export async function getAvailableStates(): Promise<string[]> {
  const [itemStates, compositionStates] = await Promise.all([
    db.selectDistinct({ stateCode: civilConstructionItems.stateCode }).from(civilConstructionItems),
    db.selectDistinct({ stateCode: civilConstructionCompositions.stateCode }).from(civilConstructionCompositions),
  ])

  const states = new Set<string>()
  itemStates.forEach((s) => states.add(s.stateCode))
  compositionStates.forEach((s) => states.add(s.stateCode))

  return Array.from(states).sort()
}

export async function getReferenceMonths(state?: string): Promise<string[]> {
  const conditions = []
  if (state) {
    conditions.push(eq(civilConstructionItems.stateCode, state.toUpperCase()))
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const result = await db
    .selectDistinct({ referenceMonth: civilConstructionItems.referenceMonth })
    .from(civilConstructionItems)
    .where(where)
    .orderBy(desc(civilConstructionItems.referenceMonth))

  return result.map((r) => r.referenceMonth)
}
