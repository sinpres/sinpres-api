import { db } from '../../db/client'
import { civilConstructionCategories } from '../../db/schema'

export async function getCategoriesBySector(schemaName: string) {
  if (schemaName === 'civil_construction') {
    return db.select().from(civilConstructionCategories)
  }
  return []
}
