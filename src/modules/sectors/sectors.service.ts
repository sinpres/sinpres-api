import { db } from '@/db/client'
import { sectors } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function getAllSectors() {
  return db.select().from(sectors)
}

export async function getSectorBySlug(slug: string) {
  const result = await db.select().from(sectors).where(eq(sectors.slug, slug))
  return result[0] ?? null
}
