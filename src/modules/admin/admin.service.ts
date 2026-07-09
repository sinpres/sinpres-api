import { desc, eq } from 'drizzle-orm'
import { db } from '../../db/client'
import { adminUsers, integrationClients } from '../../db/schema/public'
import { generateApiKey } from '../../shared/api-keys'
import type { ClientDTO } from './admin.schema'

export async function findAdminByEmail(email: string) {
  const [row] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1)
  return row ?? null
}

type ClientRow = typeof integrationClients.$inferSelect

function toDTO(row: ClientRow): ClientDTO {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    scopes: row.scopes,
    rateLimitPerUser: row.rateLimitPerUser,
    rateLimitGlobal: row.rateLimitGlobal,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  }
}

export async function listClients(): Promise<ClientDTO[]> {
  const rows = await db
    .select()
    .from(integrationClients)
    .orderBy(desc(integrationClients.createdAt))
  return rows.map(toDTO)
}

export async function createClient(input: {
  name: string
  scopes: string[]
  rateLimitPerUser: number
  rateLimitGlobal?: number | null
}): Promise<{ client: ClientDTO; apiKey: string }> {
  const { raw, keyHash, keyPrefix } = generateApiKey()
  const [row] = await db
    .insert(integrationClients)
    .values({
      name: input.name,
      keyPrefix,
      keyHash,
      scopes: input.scopes,
      rateLimitPerUser: input.rateLimitPerUser,
      rateLimitGlobal: input.rateLimitGlobal ?? null,
    })
    .returning()
  return { client: toDTO(row), apiKey: raw }
}

export async function revokeClient(id: number): Promise<ClientDTO | null> {
  const [row] = await db
    .update(integrationClients)
    .set({ active: false, revokedAt: new Date() })
    .where(eq(integrationClients.id, id))
    .returning()
  return row ? toDTO(row) : null
}
