import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { app } from '../src/app'
import {
  clearApiKeyClientCacheForTests,
  setInternalRateLimiterFactoryForTests,
} from '../src/shared/api-key-auth'
import { generateApiKey } from '../src/shared/api-keys'
import { setRateLimitLimiterForTests } from '../src/shared/rate-limit'
import { db } from '../src/db/client'
import { integrationClients } from '../src/db/schema/public'

function createMemoryLimiter(limit: number) {
  const hits = new Map<string, number>()
  const identifiers: string[] = []

  return {
    identifiers,
    limiter: {
      async limit(identifier: string, opts?: { rate?: number }) {
        const rate = opts?.rate ?? 1
        identifiers.push(identifier)
        const count = (hits.get(identifier) ?? 0) + rate
        hits.set(identifier, count)
        return {
          success: count <= limit,
          limit,
          remaining: Math.max(limit - count, 0),
          reset: Date.now() + 60_000,
        }
      },
    },
  }
}

// Factory whose limiters share one hit map per numeric limit, so exhaustion
// accumulates across requests and every call is recorded.
function createInternalFactory() {
  const perLimit = new Map<number, Map<string, number>>()
  const calls: { identifier: string; rate: number; limit: number }[] = []

  const factory = (limit: number) => {
    let bucket = perLimit.get(limit)
    if (!bucket) {
      bucket = new Map()
      perLimit.set(limit, bucket)
    }
    const hits = bucket
    return {
      async limit(identifier: string, opts?: { rate?: number }) {
        const rate = opts?.rate ?? 1
        calls.push({ identifier, rate, limit })
        const count = (hits.get(identifier) ?? 0) + rate
        hits.set(identifier, count)
        return {
          success: count <= limit,
          limit,
          remaining: Math.max(limit - count, 0),
          reset: Date.now() + 60_000,
        }
      },
    }
  }

  return { factory, calls }
}

async function insertClient(input: {
  scopes: string[]
  rateLimitPerUser: number
  rateLimitGlobal?: number | null
  active?: boolean
}) {
  const { raw, keyHash, keyPrefix } = generateApiKey()
  const [row] = await db
    .insert(integrationClients)
    .values({
      name: `test-${keyPrefix}`,
      keyPrefix,
      keyHash,
      scopes: input.scopes,
      rateLimitPerUser: input.rateLimitPerUser,
      rateLimitGlobal: input.rateLimitGlobal ?? null,
      active: input.active ?? true,
    })
    .returning({ id: integrationClients.id })
  return { id: row.id, key: raw }
}

let fullClient: { id: number; key: string }
let lowClient: { id: number; key: string }
let noScopeClient: { id: number; key: string }
let globalClient: { id: number; key: string }
let revokedClient: { id: number; key: string }
let revocableClient: { id: number; key: string }

let internal: ReturnType<typeof createInternalFactory>
let publicLimiter: ReturnType<typeof createMemoryLimiter>

beforeAll(async () => {
  fullClient = await insertClient({ scopes: ['read:items', 'read:compositions'], rateLimitPerUser: 100 })
  lowClient = await insertClient({ scopes: [], rateLimitPerUser: 1 })
  noScopeClient = await insertClient({ scopes: [], rateLimitPerUser: 100 })
  globalClient = await insertClient({ scopes: [], rateLimitPerUser: 100, rateLimitGlobal: 1 })
  revokedClient = await insertClient({ scopes: [], rateLimitPerUser: 100, active: false })
  revocableClient = await insertClient({ scopes: [], rateLimitPerUser: 100 })
})

afterAll(async () => {
  const ids = [fullClient.id, lowClient.id, noScopeClient.id, globalClient.id, revokedClient.id, revocableClient.id]
  for (const id of ids) {
    await db.delete(integrationClients).where(eq(integrationClients.id, id))
  }
})

beforeEach(() => {
  clearApiKeyClientCacheForTests()
  publicLimiter = createMemoryLimiter(1000)
  setRateLimitLimiterForTests(publicLimiter.limiter)
  internal = createInternalFactory()
  setInternalRateLimiterFactoryForTests(internal.factory)
})

afterEach(() => {
  setRateLimitLimiterForTests(null)
  setInternalRateLimiterFactoryForTests(null)
})

describe('API key auth', () => {
  it('sem X-Api-Key, ignora X-End-User-Id: mesmo IP cai no mesmo bucket público', async () => {
    await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.1', 'x-end-user-id': 'alice' },
    })
    await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.1', 'x-end-user-id': 'bob' },
    })

    expect(publicLimiter.identifiers).toEqual(['10.0.0.1', '10.0.0.1'])
    expect(internal.calls).toEqual([])
  })

  it('chave bem-formada inválida → 401 e consome o bucket público', async () => {
    const res = await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.2', 'x-api-key': `sinp_live_${'a'.repeat(24)}` },
    })

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid API key')
    expect(publicLimiter.identifiers).toEqual(['10.0.0.2'])
    expect(internal.calls).toEqual([])
  })

  it('chave malformada (foo) → 401 sem consultar o banco', async () => {
    const res = await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.3', 'x-api-key': 'foo' },
    })

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid API key')
  })

  it('cliente revogado (active=false) → 401', async () => {
    const res = await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.4', 'x-api-key': revokedClient.key },
    })

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Invalid API key')
  })

  it('chave válida → usa client:<id>:user:<uid> e responde 200', async () => {
    const res = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': fullClient.key, 'x-end-user-id': 'alice' },
    })

    expect(res.status).toBe(200)
    expect(internal.calls).toEqual([
      { identifier: `client:${fullClient.id}:user:alice`, rate: 1, limit: 100 },
    ])
    expect(publicLimiter.identifiers).toEqual([])
  })

  it('chave válida sem X-End-User-Id → bucket anonymous', async () => {
    const res = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': fullClient.key },
    })

    expect(res.status).toBe(200)
    expect(internal.calls[0]?.identifier).toBe(`client:${fullClient.id}:user:anonymous`)
  })

  it('esgotamento por usuário → 429 com Retry-After; outro X-End-User-Id ainda passa', async () => {
    const ok = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': lowClient.key, 'x-end-user-id': 'alice' },
    })
    const limited = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': lowClient.key, 'x-end-user-id': 'alice' },
    })
    const other = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': lowClient.key, 'x-end-user-id': 'bob' },
    })

    expect(ok.status).toBe(200)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBeTruthy()
    const body = await limited.json()
    expect(body.error).toBe('Rate limit exceeded')
    expect(body.retry_after).toBeGreaterThan(0)
    expect(other.status).toBe(200)
  })

  it('teto global esgotado → 429 mesmo com a cota por usuário livre', async () => {
    const first = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': globalClient.key, 'x-end-user-id': 'alice' },
    })
    const second = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': globalClient.key, 'x-end-user-id': 'bob' },
    })

    expect(first.status).toBe(200)
    expect(first.headers.get('X-RateLimit-Limit')).toBe('100')
    expect(second.status).toBe(429)
    expect(second.headers.get('X-RateLimit-Limit')).toBe('1')
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect((await second.json()).error).toBe('Rate limit exceeded')
  })

  it('escopo: sem read:items → 403 em items, 200 em sectors; com read:items → passa', async () => {
    const noScopeItems = await app.request('/api/v1/sectors/civil-construction/items', {
      headers: { 'x-api-key': noScopeClient.key, 'x-end-user-id': 'alice' },
    })
    const noScopeMeta = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': noScopeClient.key, 'x-end-user-id': 'alice' },
    })
    const withScope = await app.request('/api/v1/sectors/civil-construction/items', {
      headers: { 'x-api-key': fullClient.key, 'x-end-user-id': 'alice' },
    })

    expect(noScopeItems.status).toBe(403)
    expect((await noScopeItems.json()).error).toBe('Missing required scope: read:items')
    expect(noScopeMeta.status).toBe(200)
    expect(withScope.status).toBe(200)
  })

  it('escopo: rota gated é metrada mesmo no 403 — a segunda request cai em 429, não 403', async () => {
    const uid = 'scope-metered'
    const first = await app.request('/api/v1/sectors/civil-construction/items', {
      headers: { 'x-api-key': lowClient.key, 'x-end-user-id': uid },
    })
    const second = await app.request('/api/v1/sectors/civil-construction/items', {
      headers: { 'x-api-key': lowClient.key, 'x-end-user-id': uid },
    })

    expect(first.status).toBe(403)
    expect((await first.json()).error).toBe('Missing required scope: read:items')
    expect(internal.calls.some((x) => x.identifier === `client:${lowClient.id}:user:${uid}`)).toBe(true)
    expect(second.status).toBe(429)
  })

  it('custo: rota /expanded consome rate 5 do bucket interno', async () => {
    await app.request('/api/v1/sectors/civil-construction/compositions/1003/expanded', {
      headers: { 'x-api-key': fullClient.key, 'x-end-user-id': 'alice' },
    })

    const call = internal.calls.find((x) => x.identifier === `client:${fullClient.id}:user:alice`)
    expect(call?.rate).toBe(5)
  })

  it('revogação: após active=false + limpar cache, a chave é rejeitada em 60s', async () => {
    const before = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': revocableClient.key, 'x-end-user-id': 'alice' },
    })
    expect(before.status).toBe(200)

    await db
      .update(integrationClients)
      .set({ active: false })
      .where(eq(integrationClients.id, revocableClient.id))
    clearApiKeyClientCacheForTests()

    const after = await app.request('/api/v1/sectors', {
      headers: { 'x-real-ip': '10.0.0.11', 'x-api-key': revocableClient.key },
    })
    expect(after.status).toBe(401)
  })

  it('degrada aberto (fail-open) quando o limiter interno lança erro do Redis', async () => {
    setInternalRateLimiterFactoryForTests(() => ({ async limit() { throw new Error('redis down') } }))

    const res = await app.request('/api/v1/sectors', {
      headers: { 'x-api-key': fullClient.key, 'x-end-user-id': 'alice' },
    })

    expect(res.status).toBe(200)
  })
})
