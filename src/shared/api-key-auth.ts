import { Ratelimit } from '@upstash/ratelimit'
import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import { db } from '../db/client'
import { integrationClients } from '../db/schema/public'
import { hashApiKey, isValidApiKeyFormat } from './api-keys'
import {
  enforcePublicRateLimit,
  getRedis,
  requestCost,
  type RateLimiter,
  type RateLimitResult,
} from './rate-limit'

type ClientRow = typeof integrationClients.$inferSelect

const CLIENT_CACHE_TTL_MS = 60_000
const INTERNAL_RATE_WINDOW = '1 m'
const INTERNAL_RATE_LIMIT_PREFIX = 'rl:client'

// Positive-only cache: negative results are never cached (attacker-controlled
// random keys would grow the map unbounded), and revocation propagates within
// CLIENT_CACHE_TTL_MS per warm instance. memory-cache.ts remember() is unusable
// here because it caches negatives too.
const clientCache = new Map<string, { client: ClientRow; expiresAt: number }>()

// Ratelimit instances keyed by their numeric limit — limits are per-client values
// and the set of distinct values is small.
const internalLimiters = new Map<number, RateLimiter>()

let testLimiterFactory: ((limit: number) => RateLimiter) | null | undefined

let warnedLimiterError = false
// Fail-open on a runtime Redis error, consistent with the no-Redis path.
function warnLimiterError(error: unknown) {
  if (warnedLimiterError) return
  warnedLimiterError = true
  console.warn('Internal rate-limit check failed, failing open', error)
}

function getInternalLimiter(limit: number): RateLimiter | null {
  if (testLimiterFactory !== undefined) {
    return testLimiterFactory ? testLimiterFactory(limit) : null
  }

  const redis = getRedis()
  if (!redis) return null // fail-open, consistent with the public limiter

  const cached = internalLimiters.get(limit)
  if (cached) return cached

  const rl = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, INTERNAL_RATE_WINDOW),
    prefix: INTERNAL_RATE_LIMIT_PREFIX,
  })
  internalLimiters.set(limit, rl)
  return rl
}

async function resolveClient(keyHash: string): Promise<ClientRow | null> {
  const now = Date.now()
  const cached = clientCache.get(keyHash)
  if (cached && cached.expiresAt > now) return cached.client

  const [row] = await db
    .select()
    .from(integrationClients)
    .where(eq(integrationClients.keyHash, keyHash))
    .limit(1)

  if (!row || !row.active) return null // only found AND active rows are cached
  clientCache.set(keyHash, { client: row, expiresAt: now + CLIENT_CACHE_TTL_MS })
  return row
}

// 'read:prices' is reserved for a future prices endpoint — prices are currently
// embedded in the items/compositions payloads.
function requiredScope(path: string): string | null {
  if (/^\/api\/v1\/sectors\/[^/]+\/items(\/|$)/.test(path)) return 'read:items'
  if (/^\/api\/v1\/sectors\/[^/]+\/compositions(\/|$)/.test(path)) return 'read:compositions'
  return null
}

// SECURITY INVARIANT: X-End-User-Id is read ONLY after the API key is validated.
// Without a valid key the header is completely ignored and the request is limited
// by IP — otherwise an anonymous caller could forge X-End-User-Id to escape the
// public limit.
export const apiKeyAuth = createMiddleware(async (c, next) => {
  const rawKey = c.req.header('x-api-key')?.trim()

  // No key → public IP tier.
  if (!rawKey) {
    const denied = await enforcePublicRateLimit(c)
    if (denied) return denied
    return next()
  }

  // Malformed key → invalid without a DB lookup.
  const client = isValidApiKeyFormat(rawKey)
    ? await resolveClient(hashApiKey(rawKey))
    : null

  // Invalid/revoked key stays on the metered public bucket first, so the 401 path
  // can't become an unmetered key-probing / DB-load channel. Never fall through to
  // the public tier's next().
  if (!client) {
    const denied = await enforcePublicRateLimit(c)
    if (denied) return denied
    return c.json({ error: 'Invalid API key' }, 401)
  }

  // Meter every valid-key request before the scope gate, so a mis-scoped or leaked
  // key can't hammer scope-gated routes unmetered — the authenticated identity is
  // already established, so we always meter. Without X-End-User-Id the whole product
  // shares one bucket, so omitting the header can never grant more quota.
  const endUser = (c.req.header('x-end-user-id') ?? '').trim().slice(0, 120) || 'anonymous'
  const cost = requestCost(c.req.path)

  const perUserLimiter = getInternalLimiter(client.rateLimitPerUser)
  if (perUserLimiter) {
    let result: RateLimitResult | null = null
    try {
      result = await perUserLimiter.limit(`client:${client.id}:user:${endUser}`, { rate: cost })
    } catch (error) {
      warnLimiterError(error)
    }

    if (result) {
      void result.pending?.catch(() => undefined)

      c.header('X-RateLimit-Limit', String(result.limit))
      c.header('X-RateLimit-Remaining', String(result.remaining))
      c.header('X-RateLimit-Reset', String(result.reset))

      if (!result.success) {
        const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
        c.header('Retry-After', String(retryAfter))
        return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429)
      }
    }
  }

  // Coarse product-wide ceiling; the per-user token is already consumed when this
  // denies, which is acceptable within a 1-minute window.
  if (client.rateLimitGlobal != null) {
    const globalLimiter = getInternalLimiter(client.rateLimitGlobal)
    if (globalLimiter) {
      let result: RateLimitResult | null = null
      try {
        result = await globalLimiter.limit(`client:${client.id}:global`, { rate: cost })
      } catch (error) {
        warnLimiterError(error)
      }

      if (result) {
        void result.pending?.catch(() => undefined)

        if (!result.success) {
          // On global denial the per-user headers set above are stale; surface the
          // global bucket's numbers instead.
          c.header('X-RateLimit-Limit', String(result.limit))
          c.header('X-RateLimit-Remaining', String(result.remaining))
          c.header('X-RateLimit-Reset', String(result.reset))
          const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
          c.header('Retry-After', String(retryAfter))
          return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429)
        }
      }
    }
  }

  // Scope gate runs after metering: the request is already counted.
  const scope = requiredScope(c.req.path)
  if (scope && !client.scopes.includes(scope)) {
    return c.json({ error: `Missing required scope: ${scope}` }, 403)
  }

  return next()
})

export function setInternalRateLimiterFactoryForTests(
  factory: ((limit: number) => RateLimiter) | null | undefined,
) {
  testLimiterFactory = factory
}

export function clearApiKeyClientCacheForTests() {
  clientCache.clear()
}
