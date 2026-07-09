import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import type { Context } from 'hono'
import { env } from '../env'

const PUBLIC_RATE_LIMIT = 100
const PUBLIC_RATE_WINDOW = '1 m'
const PUBLIC_RATE_LIMIT_PREFIX = 'rl:public'

export type RateLimitResult = {
  success: boolean
  limit: number
  remaining: number
  reset: number
  pending?: Promise<unknown>
}

export type RateLimiter = {
  limit: (identifier: string, opts?: { rate?: number }) => Promise<RateLimitResult>
}

let redis: Redis | null | undefined
let limiter: RateLimiter | null | undefined
let warnedMissingRedis = false
let warnedLimiterError = false
let testLimiter: RateLimiter | null | undefined

// Vercel overwrites x-vercel-forwarded-for / x-real-ip with the real client IP
// and does not let the client spoof them; cf-connecting-ip and x-forwarded-for
// ARE client-controlled and must not be trusted as a rate-limit identity.
export function getSecureClientIp(c: Context): string {
  const runtimeEnv = c.env as { ip?: string } | undefined
  return (
    c.req.header('x-vercel-forwarded-for')
    ?? c.req.header('x-real-ip')
    ?? runtimeEnv?.ip
    ?? 'unknown'
  ).trim() || 'unknown'
}

// Bulk answers up to 100 queries per call and expanded recurses the tree, so they
// cost more backend work than a single lookup and consume proportionally more units.
export function requestCost(path: string): number {
  if (path.endsWith('/bulk')) return 10
  if (path.endsWith('/expanded')) return 5
  return 1
}

export function getRedis(): Redis | null {
  if (redis !== undefined) return redis

  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    redis = null
    return redis
  }

  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  })
  return redis
}

function getLimiter(): RateLimiter | null {
  if (testLimiter !== undefined) return testLimiter
  if (limiter !== undefined) return limiter

  const activeRedis = getRedis()
  if (!activeRedis) {
    if (env.NODE_ENV !== 'test' && !warnedMissingRedis) {
      console.warn('Rate-limit disabled: missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN')
      warnedMissingRedis = true
    }

    limiter = null
    return limiter
  }

  limiter = new Ratelimit({
    redis: activeRedis,
    limiter: Ratelimit.slidingWindow(PUBLIC_RATE_LIMIT, PUBLIC_RATE_WINDOW),
    prefix: PUBLIC_RATE_LIMIT_PREFIX,
  })

  return limiter
}

// Runs the public IP rate-limit: sets X-RateLimit-* headers and returns the 429
// Response when denied, or null when allowed (or when no limiter is configured).
export async function enforcePublicRateLimit(c: Context): Promise<Response | null> {
  const activeLimiter = getLimiter()
  if (!activeLimiter) return null

  const identifier = getSecureClientIp(c)
  let result: RateLimitResult
  try {
    result = await activeLimiter.limit(identifier, { rate: requestCost(c.req.path) })
  } catch (error) {
    // Fail-open on a runtime Redis error, consistent with the no-Redis path.
    if (!warnedLimiterError) {
      warnedLimiterError = true
      console.warn('Public rate-limit check failed, failing open', error)
    }
    return null
  }
  void result.pending?.catch(() => undefined)

  c.header('X-RateLimit-Limit', String(result.limit))
  c.header('X-RateLimit-Remaining', String(result.remaining))
  c.header('X-RateLimit-Reset', String(result.reset))

  if (!result.success) {
    const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))
    c.header('Retry-After', String(retryAfter))
    return c.json({ error: 'Rate limit exceeded', retry_after: retryAfter }, 429)
  }

  return null
}

export function setRateLimitLimiterForTests(nextLimiter: RateLimiter | null | undefined) {
  testLimiter = nextLimiter
}
